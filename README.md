# Stickman City Runner 3D

A high-performance 3D runner game built with **Three.js** and **Vite**.

## Features
- 🏃 **Infinite Running:** Procedurally generated obstacles.
- 🏙️ **City Atmosphere:** Parallax background buildings.
- 🤸 **Parkour Moves:** Jump over buildings, slide under barriers.
- ✨ **Effects:** Particle systems for dust and stylized toon shaders.
- 📱 **Mobile Ready:** Touch controls included.

## Installation

This project uses Node.js. Make sure you have it installed.

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Start Development Server:**
    ```bash
    npm run dev
    ```
    Then open the link shown (usually `http://localhost:5173`).

## Building for GitHub Pages

To deploy this game to the web:

1.  **Build the project:**
    ```bash
    npm run build
    ```
    This creates a `dist` folder with optimized files.

2.  **Deploy:**
    Upload the contents of the `dist` folder to your web server or push the `dist` folder to a `gh-pages` branch on GitHub.

    *Note: For GitHub Pages, you might need to configure the `base` path in `vite.config.js` if you are not using a custom domain.*

## Controls
- **PC:**
  - Jump: `Space` or `Up Arrow`
  - Slide: `Down Arrow`
- **Mobile:**
  - On-screen buttons
