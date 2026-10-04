# Welcome to my project

## How can I edit this code?

There are several ways of editing your application.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also work.

Use Node.js 22.13 or newer and npm - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the web app and SQLite catalog API.
npm run dev
```

The managed price catalog is stored in `data/catalog.sqlite`. Catalog additions,
edits, deletions, and resets are shared by every browser connected to this server.
The first run seeds the database from the default price sheet (and imports any
existing browser-local catalog if present).

To build and run the app with its API in production:

```sh
npm run build
npm start
```

The server binds to localhost by default. To make it reachable from other devices
on a trusted network, set `HOST=0.0.0.0` before starting it. Keep the server on a
trusted network; the catalog API does not include user authentication.

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS
