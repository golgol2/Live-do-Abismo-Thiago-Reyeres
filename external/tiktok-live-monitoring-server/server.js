const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const { TikTokConnectionWrapper } = require('./connectionWrapper');
const request = require('request');
const cors = require('cors');
const { reverseInPlace } = require('./function');

const PORT = Number(process.env.TIKTOK_MONITOR_PORT || 2618);
const app = express();
const server = http.createServer(app);
const ws = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.static('public'));

let usernames = [];
let activeListenWrapper = null;

ws.on('connection', socket => {
    console.log('New client connected');
    let tiktokConnectionWrapper;

    socket.on('getHistory', () => {
        socket.emit('self:history', JSON.stringify(usernames));
    });

    socket.on('listenToUsername', data => {
        const { username, proxy } = JSON.parse(data);
        if (!username) return;

        if (proxy) console.log('Using proxy');

        try {
            if (tiktokConnectionWrapper?.connection) {
                tiktokConnectionWrapper.connection.disconnect();
            }
            if (activeListenWrapper && activeListenWrapper !== tiktokConnectionWrapper) {
                try {
                    activeListenWrapper.disconnect();
                } catch (err) {
                    console.error('Failed to disconnect previous active listener', err);
                }
            }

            // TODO: Proxy
            tiktokConnectionWrapper = new TikTokConnectionWrapper(username, undefined, true);
            activeListenWrapper = tiktokConnectionWrapper;
            tiktokConnectionWrapper.connect();

            setupConnectionEvents(tiktokConnectionWrapper, socket, username);
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        if (tiktokConnectionWrapper && activeListenWrapper === tiktokConnectionWrapper) {
            tiktokConnectionWrapper.disconnect();
            activeListenWrapper = null;
        }
    });

    socket.on('stopListen', () => {
        console.log('Client asking to stop');
        if (tiktokConnectionWrapper && activeListenWrapper === tiktokConnectionWrapper) {
            tiktokConnectionWrapper.disconnect();
            if (tiktokConnectionWrapper?.connection) {
                tiktokConnectionWrapper.connection.disconnect();
            }
            activeListenWrapper = null;
        }
        socket.emit('data-connection', JSON.stringify({ isConnected: false }));
    });
});

function setupConnectionEvents(wrapper, socket, username) {
    wrapper.once('connected', state => {
        usernames.push(username);
        socket.emit('data-connection', JSON.stringify({ isConnected: true, state }));
    });

    wrapper.once('disconnected', reason => {
        let message = reason;
        const reasonText = reason.toString();
        if (reasonText.includes('EAI_FAIL') || reasonText.includes('Unable to resolve') || reasonText.includes('Could not resolve')) {
            message = 'Falha de DNS/rede via Tor ao buscar a live no TikTok. Tor e obrigatorio; reinicie o Tor ou aguarde novo circuito.';
        } else if (reasonText.includes('status code 451')) {
            message = 'TikTok recusou a consulta da live com status 451. Normalmente e bloqueio/regiao/Tor ou live ainda indisponivel para monitoramento.';
        } else if (reasonText.includes('Failed to retrieve room_id from page source')) {
            message = 'Nao foi possivel obter o room_id da live. Verifique se a live ja esta aberta e se o usuario esta correto.';
        } else if (reasonText.includes('not offer a websocket upgrade.')) {
            message = 'Considering to use proxy or change server';
        }
        socket.emit('data-connection', JSON.stringify({ isConnected: false, message }));
    });

    wrapper.connection.on('streamEnd', () => {
        if (activeListenWrapper === wrapper) {
            activeListenWrapper = null;
        }
        socket.emit(
            'data-connection',
            JSON.stringify({ isConnected: false, message: 'Stream ended. Reconnecting to current live room.' }),
        );
    });

    wrapper.on('roomInfo', roomInfo => socket.emit('data-roomInfo', roomInfo));
    wrapper.connection.on('liveIntro', data =>
        socket.emit('data-liveIntro', JSON.stringify({ data })),
    );
    wrapper.on('dataMessage', data => socket.emit('data-message', data));

    // Event mappings for TikTok connection
    wrapper.connection.on('chat', data => socket.emit('data-chat', JSON.stringify(data)));
    wrapper.connection.on('gift', data => socket.emit('data-gift', JSON.stringify(data)));
    wrapper.connection.on('member', data => socket.emit('data-member', JSON.stringify(data)));
    wrapper.connection.on('roomUser', data => socket.emit('data-viewer', JSON.stringify(data)));
    wrapper.connection.on('like', data => socket.emit('data-like', JSON.stringify(data)));
    wrapper.connection.on('social', data => {
        socket.emit('data-social', JSON.stringify(data));
        const displayType = String(data?.displayType || '').toLowerCase();
        const label = String(data?.label || '').toLowerCase();
        if (displayType.includes('share') || label.includes('shared') || label.includes('compartilhou')) {
            socket.emit('data-share', JSON.stringify(data));
        } else if (displayType.includes('follow') || label.includes('followed') || label.includes('seguiu')) {
            socket.emit('data-follow', JSON.stringify(data));
        }
    });
    wrapper.connection.on('share', data => socket.emit('data-share', JSON.stringify(data)));
    wrapper.connection.on('follow', data => socket.emit('data-follow', JSON.stringify(data)));
    wrapper.connection.on('linkMicBattle', data =>
        socket.emit('data-micBattle', JSON.stringify(data)),
    );
    wrapper.connection.on('linkMicArmies', data =>
        socket.emit('data-micArmies', JSON.stringify(data)),
    );
    wrapper.connection.on('subscribe', data => socket.emit('data-subscribe', JSON.stringify(data)));

    // TODO: Debug other events
    wrapper.connection.on('questionNew', data =>
        socket.emit('data-debug', JSON.stringify({ data, listener: 'questionNew' })),
    );
    wrapper.connection.on('emote', data =>
        socket.emit('data-debug', JSON.stringify({ data, listener: 'emote' })),
    );
    wrapper.connection.on('envelope', data =>
        socket.emit('data-debug', JSON.stringify({ data, listener: 'envelope' })),
    );
}

app.get('/hist', (req, res) => {
    res.json(usernames);
});

app.get('/proxy-stream/:url/:segment', async (req, res) => {
    const { url, segment } = req.params;
    try {
        const query = req.query;
        let streamUrl = Buffer.from(reverseInPlace(url), 'base64').toString('utf-8');

        if (streamUrl.includes('index.m3u8')) {
            streamUrl = streamUrl.replace('index.m3u8', segment);
        } else if (streamUrl.includes('.m3u8')) {
            const parts = streamUrl.split('/');
            parts[parts.length - 1] = segment;
            streamUrl = parts.join('/');
        } else {
            console.error(`Unknown url`, { url }, { segment });
        }

        if (Object.keys(query).length > 0) {
            streamUrl += '?' + new URLSearchParams(query).toString();
        }

        request(streamUrl)
            .on('response', response => {
                res.set(response.headers);
                res.header('Access-Control-Allow-Origin', '*');
            })
            .on('error', err => {
                console.error('Error fetching segment:', err);
                res.sendStatus(500);
            })
            .pipe(res);
    } catch (err) {
        res.sendStatus(400).json({ message: 'sad' });
    }
});

app.get('/proxy-stream/:url/', async (req, res) => {
    try {
        const { url } = req.params;
        const streamUrl = Buffer.from(reverseInPlace(url), 'base64').toString('utf-8');

        request(streamUrl)
            .on('response', response => {
                res.set(response.headers);
                res.header('Access-Control-Allow-Origin', '*');
            })
            .on('error', err => {
                console.error('Error fetching segment:', err);
                res.sendStatus(500);
            })
            .pipe(res);
    } catch (err) {
        res.sendStatus(400).json({ message: 'sad' });
    }
});

app.post('/webhooks', async (req, res) => {
    const test = await req.body();
    res.json(test);
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
