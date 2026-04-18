# Uzbet (Discord Bot)

Uzbet is a comprehensive Discord bot designed to bring a full-fledged casino and economy experience to your server. Built with `discord.js`, it offers a wide array of games, an in-depth economy system, and various features to engage and entertain your community.

## Features

*   **Extensive Game Collection:** Includes popular casino games like Slots, Coinflip, Roulette, Blackjack, Crash, Mines, Towers, Keno, and Limbo.
*   **Robust Economy System:** Manages user balances, leaderboards, daily claims, tipping, rain, and rakeback.
*   **Promotional Tools:** Features for creating and redeeming promos, affiliate panels, and prize pools.
*   **Verification & Moderation:** Tools for setting verify roles, wager roles, and managing withdrawals/deposits.
*   **Customizable:** Highly configurable to suit your server's needs.

## Technologies Used

*   **Language:** JavaScript
*   **Framework:** Node.js, Discord.js
*   **Database:** (Likely a NoSQL database like MongoDB, based on `db.js`)

## Project Structure

```
uzbet/
├── db.js                   # Database connection and operations
├── economy.js              # Core economy system logic (balance, leaderboard, etc.)
├── features.js             # Advanced features (promos, affiliates, verification, withdrawals)
├── games.js                # Implementations of various casino games
├── index.js                # Main bot entry point and event handler
├── package.json            # Project dependencies and scripts
└── README.md               # Project documentation
```

## Setup Instructions

To set up and run Uzbet on your Discord server, follow these steps:

### 1. Prerequisites

*   **Node.js:** Ensure you have Node.js (LTS version recommended) installed.
*   **Database:** A compatible database (e.g., MongoDB) and its connection string.
*   **Discord Bot Token:** Create a new application on the [Discord Developer Portal](https://discord.com/developers/applications) and obtain your bot token.
*   **Discord Client ID:** Get your bot's client ID from the Discord Developer Portal.

### 2. Clone the Repository

```bash
git clone https://github.com/imtealplayz/uzbet.git
cd uzbet
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the root directory of the project and add the following:

```
BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN
CLIENT_ID=YOUR_DISCORD_CLIENT_ID
MONGO_URI=YOUR_MONGODB_CONNECTION_STRING # If using MongoDB
```

*Replace the placeholder values with your actual bot token, client ID, and database connection string.*

### 5. Run the Bot

```bash
node index.js
```

The bot should now be online and ready to join your Discord server. Ensure you have invited the bot to your server with the necessary permissions.
