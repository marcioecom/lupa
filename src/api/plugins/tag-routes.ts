import type { FastifyInstance } from "fastify";

export function tagRoutes(app: FastifyInstance, tag: string): void {
  app.addHook("onRoute", (route) => {
    route.schema = {
      ...route.schema,
      tags: route.schema?.tags ?? [tag],
    };
  });
}
