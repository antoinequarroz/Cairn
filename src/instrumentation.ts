/**
 * Remontée des erreurs du serveur vers Orbi (le monitoring de la suite), avec le SDK Sentry : Orbi
 * accepte son protocole tel quel. Côté serveur seulement : aucune page ne charge de script en plus,
 * et la Content-Security-Policy ne change pas.
 *
 * SENTRY_DSN vide = rien n'est envoyé (développement, tests). En production : le DSN du projet
 * « Cairn » d'Orbi (orbi.postmelo.ch > Cairn > Brancher).
 */
import type { Instrumentation } from "next";

export async function register() {
  // Écrit ainsi pour que Next.js retire l'import de la version Edge (où @sentry/node ne tourne pas).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startErrorReporting } = await import("./lib/error-reporting.node");
    await startErrorReporting();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("./lib/error-reporting.node");
    await reportRequestError(error, request, context);
  }
};
