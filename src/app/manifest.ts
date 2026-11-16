import type { MetadataRoute } from "next";

// Lets Cairn be installed as an app: "Ajouter au Dock" on Mac, "Sur l'écran d'accueil" on iPhone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cairn",
    short_name: "Cairn",
    description: "Notes en Markdown et coffre de mots de passe et de clés.",
    start_url: "/notes",
    display: "standalone",
    background_color: "#efede8",
    theme_color: "#efede8",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
