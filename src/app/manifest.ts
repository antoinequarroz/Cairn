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
    // The dark variant is the approved one for installed icons, whatever the page's theme.
    icons: [
      { src: "/brand/cairn/app-dark-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/cairn/app-dark-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/cairn/maskable-dark-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/brand/cairn/maskable-dark-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
