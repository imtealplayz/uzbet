# Uzbet

A Discord casino and economy bot prototype built with Node.js and discord.js.

## Features

- Casino-style games including slots, blackjack, roulette, crash, mines, towers, keno, limbo, and coinflip
- User balances and economy progression
- Leaderboards, daily rewards, tipping, rain, and rakeback-style systems
- Promotional, verification, and server-management features
- Persistent database-backed state

## Stack

- JavaScript
- Node.js
- discord.js
- Database layer in `db.js`

## Setup

```bash
npm install
node index.js
```

Configure the Discord credentials and database connection expected by the project in `.env`. Never commit tokens or database credentials.

## Structure

```text
db.js        Database access
economy.js   Economy and balances
features.js  Server/economy features
games.js     Game implementations
index.js     Bot entry point
```

## Status

Experimental Discord economy/game project.
