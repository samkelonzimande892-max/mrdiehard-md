import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const PREFIX = '.';

async function startServer() {
    // Manage authentication state locally inside the 'session' folder
    const { state, saveCreds } = await useMultiFileAuthState('session');

    // Initialize Baileys socket connection with minimal logging
    const sock = makeWASocket.default({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false // Disabled to prioritize pairing code
    });

    // Handle Pairing Code Flow if not already authenticated
    if (!sock.authState.creds.registered) {
        console.clear();
        console.log('🦁 --- MRDIEHARD MD PAIRING SERVER --- 🦁\n');
        
        let phoneNumber = await question('📱 Enter your phone number with country code (e.g., 1234567890): ');
        phoneNumber = phoneNumber.replace(/\D/g, '');

        if (phoneNumber.length > 0) {
            try {
                setTimeout(async () => {
                    let code = await sock.requestPairingCode(phoneNumber);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log('\n======================================');
                    console.log(`🔑 YOUR PAIRING CODE: ${code}`);
                    console.log('======================================');
                    console.log('Go to WhatsApp > Linked Devices > Link with phone number and enter this code.\n');
                }, 3000);
            } catch (err) {
                console.error('❌ Failed to request pairing code. Please restart.', err);
                process.exit(1);
            }
        } else {
            console.log('❌ Invalid phone number format.');
            process.exit(1);
        }
    }

    // Monitor Connection Updates
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Connection closed due to error, reconnecting: ', shouldReconnect);
            if (shouldReconnect) startServer();
        } else if (connection === 'open') {
            console.log('🚀 MRDIEHARD MD is securely connected and active on the server!');
        }
    });

    // Save credentials whenever updated
    sock.ev.on('creds.update', saveCreds);

    // Command Handler
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Extract message text string safely
        const messageType = Object.keys(msg.message)[0];
        const body = messageType === 'conversation' ? msg.message.conversation :
                     messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';

        if (!body.startsWith(PREFIX)) return;

        const args = body.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();
        const from = msg.key.remoteJid;

        // Helper send function
        const reply = async (text) => {
            await sock.sendMessage(from, { text: text }, { quoted: msg });
        };

        switch (command) {
            case 'ping': {
                const start = Date.now();
                await reply('⚡ Testing socket latency...');
                const latency = Date.now() - start;
                await reply(`🏓 *Pong!* \n• Speed: \`${latency}ms\``);
                break;
            }

            case 'server':
            case 'runtime': {
                const uptime = process.uptime();
                const h = Math.floor(uptime / 3600);
                const m = Math.floor((uptime % 3600) / 60);
                const s = Math.floor(uptime % 60);
                
                await reply(`💻 *MRDIEHARD MD Server Status*\n• *Uptime:* ${h}h ${m}m ${s}s\n• *Memory Usage:* \`${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\``);
                break;
            }

            case 'menu':
            case 'help': {
                const menu = `⚙️ *MRDIEHARD MD OPERATIONAL MENU*\n\n` +
                             `*📊 SYSTEM INFO*\n` +
                             `• ${PREFIX}ping - Check server response speed.\n` +
                             `• ${PREFIX}server - Fetch host system environment statistics.\n\n` +
                             `*🔧 CONTROLS*\n` +
                             `• ${PREFIX}echo [text] - Instruct the bot to mirror text.`;
                await reply(menu);
                break;
            }

            case 'echo':
                if (!args.length) return await reply('Provide text parameters.');
                await reply(args.join(' '));
                break;

            default:
                break;
        }
    });
}

startServer();
