import fastifySwagger from "@fastify/swagger";
import scalarApiReference from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";
import { config } from "../../config";

const TAGS = [
  { name: "health", description: "Liveness/readiness" },
  { name: "meta", description: "Metadados de scraping" },
  { name: "licitacoes", description: "Licitações do TCE-TO (~670 registros)" },
  { name: "contratos", description: "Contratos do TCE-TO (~1.191 registros)" },
  { name: "obras", description: "Obras e serviços de engenharia do TCE-TO (~14 registros)" },
];

export async function registerDocs(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "lupa API",
        description:
          "API REST sobre dados extraídos do portal de transparência do TCE-TO " +
          "(Tribunal de Contas do Estado do Tocantins). Cobre licitações, contratos " +
          "e obras, alimenta painéis de BI.",
        version: "0.1.0",
      },
      servers: [{ url: config.API_URL ?? `http://${config.API_HOST}:${config.API_PORT}` }],
      tags: TAGS,
    },
  });

  await app.register(scalarApiReference, {
    routePrefix: "/docs",
    configuration: { pageTitle: "lupa API" },
  });
}
