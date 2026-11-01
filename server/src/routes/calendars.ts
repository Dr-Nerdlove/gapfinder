import {
  CALENDAR_LINK_MAX_LENGTH,
  CALENDARS_PER_USER,
  type AddCalendarRequest,
  type Calendar,
  type CalendarList,
  type CalendarPreview,
  type UpdateCalendarRequest,
} from "@lueckenfueller/shared";
import type { FastifyInstance } from "fastify";
import { authOf, createGuards } from "../auth/guards.js";
import {
  buildPreview,
  checkedCalendarName,
  checkLink,
  nameForNew,
  rememberContents,
  requireCalendarKey,
} from "../calendars/service.js";
import {
  countCalendars,
  deleteCalendar,
  findCalendar,
  insertCalendar,
  listCalendars,
  replaceLink,
  setDefault,
  toCalendar,
  updateSettings,
} from "../calendars/store.js";
import type { AppContext } from "../context.js";
import { inTransaction } from "../db.js";
import { ApiError, notFound } from "../errors.js";
import { idParam } from "./shared.js";

const addBody = {
  type: "object",
  required: ["link"],
  properties: {
    link: { type: "string", maxLength: CALENDAR_LINK_MAX_LENGTH },
    name: { type: "string", maxLength: 1000 },
  },
} as const;

const updateBody = {
  type: "object",
  properties: {
    name: { type: "string", maxLength: 1000 },
    countsAsBusy: { type: "boolean" },
    isDefault: { const: true },
    link: { type: "string", maxLength: CALENDAR_LINK_MAX_LENGTH },
  },
} as const;

/** All routes below `/api/calendars`: a person's own calendars, never anybody else's. */
export function registerCalendarRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser } = createGuards(ctx);

  app.get("/api/calendars", { onRequest: requireUser }, async (request): Promise<CalendarList> => {
    const { user } = authOf(request);
    return {
      state: ctx.calendarKeyStatus === "ok" ? "ready" : "unavailable",
      calendars: listCalendars(ctx.db, user.id).map(toCalendar),
    };
  });

  app.get("/api/calendars/preview", { onRequest: requireUser }, async (request): Promise<CalendarPreview> => {
    requireCalendarKey(ctx);
    return buildPreview(ctx, authOf(request).user.id);
  });

  app.post<{ Body: AddCalendarRequest }>(
    "/api/calendars",
    { onRequest: requireUser, schema: { body: addBody } },
    async (request, reply): Promise<Calendar> => {
      const { user } = authOf(request);
      requireCalendarKey(ctx);
      if (countCalendars(ctx.db, user.id) >= CALENDARS_PER_USER) throw new ApiError(409, "calendar_limit");
      // A name that is too long is the person's mistake: say so before any outgoing request.
      if (request.body.name !== undefined) checkedCalendarName(request.body.name);

      const checked = await checkLink(ctx, user.id, request.body.link);
      const now = ctx.now().toISOString();
      const id = inTransaction(ctx.db, () => {
        // Two requests at once must not get past the limit together.
        if (countCalendars(ctx.db, user.id) >= CALENDARS_PER_USER) throw new ApiError(409, "calendar_limit");
        return insertCalendar(ctx.db, {
          userId: user.id,
          name: nameForNew(request.body.name, checked.parsed),
          provider: checked.provider,
          linkEncrypted: checked.linkEncrypted,
          now,
        });
      });
      rememberContents(ctx, id, checked.linkEncrypted, checked.parsed);
      return reply.status(201).send(toCalendar(findCalendar(ctx.db, user.id, id)!));
    },
  );

  app.patch<{ Body: UpdateCalendarRequest }>(
    "/api/calendars/:id",
    { onRequest: requireUser, schema: { body: updateBody } },
    async (request): Promise<Calendar> => {
      const { user } = authOf(request);
      const id = idParam(request);
      if (!findCalendar(ctx.db, user.id, id)) throw notFound();
      const { name, countsAsBusy, isDefault, link } = request.body;
      const newName = name === undefined ? undefined : checkedCalendarName(name);

      // A new link needs the key and is tried before anything is changed.
      const checked = link === undefined ? undefined : await checkLink(ctx, user.id, link);

      const now = ctx.now().toISOString();
      const changed = inTransaction(ctx.db, () => {
        // The calendar may have been deleted while the link was being checked.
        if (!findCalendar(ctx.db, user.id, id)) return false;
        updateSettings(ctx.db, id, { name: newName, countsAsBusy }, now);
        if (checked) replaceLink(ctx.db, id, checked, now);
        if (isDefault === true) setDefault(ctx.db, user.id, id, now);
        return true;
      });
      if (!changed) throw notFound();
      if (checked) {
        ctx.calendarCache.drop(id);
        rememberContents(ctx, id, checked.linkEncrypted, checked.parsed);
      }
      return toCalendar(findCalendar(ctx.db, user.id, id)!);
    },
  );

  app.delete("/api/calendars/:id", { onRequest: requireUser }, async (request, reply) => {
    const { user } = authOf(request);
    const id = idParam(request);
    const deleted = inTransaction(ctx.db, () => deleteCalendar(ctx.db, user.id, id, ctx.now().toISOString()));
    if (!deleted) throw notFound();
    ctx.calendarCache.drop(id);
    return reply.status(204).send();
  });
}
