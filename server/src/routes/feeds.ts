import type { CalendarFeed } from "@lueckenfueller/shared";
import type { FastifyInstance } from "fastify";
import { authOf, createGuards } from "../auth/guards.js";
import { writeCalendar } from "../calendars/ics-write.js";
import type { AppContext } from "../context.js";
import { notFound } from "../errors.js";
import { deleteFeed, feedEventsOf, findFeedOwner, findFeedToken, renewFeedToken } from "../polls/feed.js";

/** The personal calendar feed: the owner manages the link, calendar apps read it (see `CalendarFeed`). */
export function registerFeedRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { requireUser } = createGuards(ctx);

  app.get(
    "/api/me/calendar-feed",
    { onRequest: requireUser },
    async (request): Promise<CalendarFeed> => ({ token: findFeedToken(ctx.db, authOf(request).user.id) }),
  );

  app.post(
    "/api/me/calendar-feed",
    { onRequest: requireUser },
    async (request): Promise<CalendarFeed> => ({
      token: renewFeedToken(ctx.db, authOf(request).user.id, ctx.now()),
    }),
  );

  app.delete("/api/me/calendar-feed", { onRequest: requireUser }, async (request, reply) => {
    deleteFeed(ctx.db, authOf(request).user.id);
    return reply.status(204).send();
  });

  app.get("/api/calendar-feeds/:token", async (request, reply) => {
    // Calendar apps usually want an address ending in ".ics": the token works with or without it.
    const token = (request.params as { token: string }).token.replace(/\.ics$/i, "");
    const userId = findFeedOwner(ctx.db, token);
    // A wrong token is NOT counted in the per-address bucket of wrong invite and share links (and a blocked
    // address is not refused here): services like Google fetch feeds from shared addresses, so one person's
    // old, renewed link would otherwise lock everybody's feed out through that address. A 128-bit token cannot
    // be guessed, so the count would protect nothing.
    if (userId === undefined) throw notFound();
    return reply
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(writeCalendar(feedEventsOf(ctx.db, userId, ctx.now()), { feed: true }));
  });
}
