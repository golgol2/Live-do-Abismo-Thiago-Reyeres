# TikTok Live Monitoring (Server)

This is the server for **[Tiktok Live Monitoring (WebUI)](https://github.com/farizrifqi/tiktok-live-monitoring-webui)**, a project designed to interact with TikTok Livestreams.

This server uses **[TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector/)** to connect to TikTok Livestreams and relay real-time events such as chat messages, gifts, likes, and more to the client.

---

## Features

-   **Real-time TikTok Live Events**: Listen to live events such as chat messages, gifts, likes, shares, follows, and more.
-   **WebSocket Support**: Uses WebSocket to provide real-time updates to the client.
-   **Proxy Support**: Allows the use of proxies to bypass regional restrictions.
-   **Reconnection Logic**: Automatically reconnects to the TikTok Livestream if the connection is lost.
-   **Room Info Retrieval**: Fetches room information (e.g., viewer count, stream status) when connecting to a livestream.
-   **History Tracking**: Keeps track of usernames that have been listened to.
-   Stream Proxy is available under `/proxy-stream/` route. For the Cloudflare Worker version, visit **[Tiktok Live Proxy](https://github.com/farizrifqi/tiktok-live-proxy)**.

---

## Installation

1. Clone this repository:
    ```bash
    git clone https://github.com/farizrifqi/tiktok-live-monitoring-server.git
    cd adv-ttl-server
    ```
2. Install dependencies:
    ```bash
    npm install
    ```
3. Start the server:
    ```bash
    node server.js
    ```

---

## Usage

### Server Endpoints

-   **WebSocket Connection**: The server listens for WebSocket connections at `ws://localhost:2608`.
-   **History Endpoint**: Retrieve the list of usernames that have been listened to:
    ```
    GET /hist
    ```
-   **Proxy Stream Endpoint**: Proxy TikTok Livestream segments (used for bypassing restrictions):
    ```
    GET /proxy-stream/:url/:segment
    GET /proxy-stream/:url/
    ```

### WebSocket Events

The server emits the following events to the client:

-   `self:history`: Sends the history of listened usernames.
-   `data-connection`: Notifies the client about the connection status - (connected/disconnected).
-   `data-roomInfo`: Sends room information (e.g., viewer count, stream status).
-   `data-liveIntro`: Sends livestream introduction data.
-   `data-message`: Sends general messages or errors.
-   `data-chat`: Relays chat messages from the livestream.
-   `data-gift`: Relays gift events from the livestream.
-   `data-member`: Relays member join events.
-   `data-viewer`: Relays viewer count updates.
-   `data-like`: Relays like events.
-   `data-share`: Relays share events.
-   `data-follow`: Relays follow events.
-   `data-micBattle`: Relays link mic battle events.
-   `data-micArmies`: Relays link mic armies events.
-   `data-subscribe`: Relays subscription events.
-   `data-debug`: Debug events for testing purposes.

---

## Configuration

The server is configured to run on port `2608` by default. You can change this by modifying the `PORT` variable in `index.js`.

## Environment Variables

No environment variables are required for basic usage. However, if you need to use a proxy, you can pass the proxy configuration via the `listenToUsername` event.

---

Dependencies

-   [Express.js](https://expressjs.com/): Web framework for handling HTTP requests.
-   [Socket.IO](https://socket.io/): Enables real-time, bidirectional communication between the server and client.
-   [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector/): Library for connecting to TikTok Livestreams.
-   [Request](https://github.com/request/request): Simplified HTTP client for proxying stream segments.

---

## Contributing

Contributions are welcome! If you find any issues or have suggestions for improvements, feel free to open an issue or submit a pull request.

## Acknowledgments

-   [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector/): For providing the core functionality to connect to TikTok Livestreams.
-   [Tiktok Live Monitoring (WebUI)](https://github.com/farizrifqi/tiktok-live-monitoring-webui): The client-side application that interacts with this server.
-   [Tiktok Live Proxy](https://github.com/farizrifqi/tiktok-live-proxy): For providing the stream proxy functionality using Cloudflare Workers.
