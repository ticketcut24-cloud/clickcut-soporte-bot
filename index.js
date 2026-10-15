const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

// Servidor Express para Render
const app = express();
const port = process.env.PORT || 3000;

let qrActual = null;
let botConectado = false;

// Página de inicio de Render
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
            <h2>🟢 Bot Click&Cut Activo</h2>
            <p>Estado de WhatsApp: <b>${botConectado ? 'Conectado ✅' : 'Esperando vinculación ⏳'}</b></p>
            ${!botConectado ? '<p><a href="/qr" style="color: blue; text-decoration: underline;">👉 Haz clic aquí para ver el código QR y escanear</a></p>' : ''}
        </div>
    `);
});

// Ruta visual para ver y escanear el QR nítido
app.get('/qr', async (req, res) => {
    if (botConectado) {
        return res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h2 style="color: green;">✅ El bot ya está vinculado y conectado a WhatsApp.</h2>
                <p>No es necesario escanear de nuevo.</p>
            </div>
        `);
    }

    if (!qrActual) {
        return res.send(`
            <div style="font-family: Arial, sans-serif; text-align: center; margin-top: 50px;">
                <h2>⏳ Generando código QR...</h2>
                <p>Espera unos 5 segundos y recarga esta página.</p>
                <script>setTimeout(() => { location.reload(); }, 4000);</script>
            </div>
        `);
    }

    try {
        const qrImage = await QRCode.toDataURL(qrActual);
        res.send(`
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 90vh; font-family: Arial, sans-serif;">
                <h2>Escanea este código con WhatsApp</h2>
                <p>WhatsApp > Dispositivos vinculados > Vincular un dispositivo</p>
                <img src="${qrImage}" alt="QR WhatsApp" style="width: 320px; height: 320px; border: 4px solid #333; border-radius: 8px;" />
                <p style="color: #666; font-size: 14px; margin-top: 15px;">La página se actualizará automáticamente si el código vence.</p>
                <script>setTimeout(() => { location.reload(); }, 20000);</script>
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error generando la imagen del código QR');
    }
});

app.listen(port, () => console.log(`Servidor web activo en puerto ${port}`));

// Gestión de Comandos Dinámicos (.addcmd, .delcmd)
const RUTA_COMANDOS = path.join(__dirname, 'comandos.json');

function cargarComandos() {
    if (!fs.existsSync(RUTA_COMANDOS)) {
        fs.writeFileSync(RUTA_COMANDOS, JSON.stringify({}, null, 2));
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(RUTA_COMANDOS, 'utf-8'));
    } catch {
        return {};
    }
}

function guardarComandos(datos) {
    fs.writeFileSync(RUTA_COMANDOS, JSON.stringify(datos, null, 2));
}

let comandosPersonalizados = cargarComandos();

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_soporte');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        browser: Browsers.macOS('Desktop')
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrActual = qr;
            console.log('📌 Nuevo código QR disponible en la ruta web /qr');
        }

        if (connection === 'close') {
            botConectado = false;
            qrActual = null;
            const reconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando:', reconectar);
            if (reconectar) iniciarBot();
        } else if (connection === 'open') {
            botConectado = true;
            qrActual = null;
            console.log('✅ Bot Click&Cut conectado exitosamente a WhatsApp.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const texto = (
            msg.message.conversation || 
            msg.message.extendedTextMessage?.text || 
            ''
        ).trim();

        const jid = msg.key.remoteJid;
        const esGrupo = jid.endsWith('@g.us');
        if (!esGrupo) return;

        const sender = msg.key.participant || jid;
        const remitenteNum = sender.split('@')[0];

        async function esAdmin(jidGrupo, usuarioJid) {
            try {
                const metadata = await sock.groupMetadata(jidGrupo);
                const participante = metadata.participants.find(p => p.id === usuarioJid);
                return participante?.admin === 'admin' || participante?.admin === 'superadmin';
            } catch (err) {
                return false;
            }
        }

        // ==========================================
        // COMANDOS DE ADMINISTRADOR PARA CREAR/BORRAR
        // ==========================================

        if (texto.toLowerCase().startsWith('.addcmd')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const partes = texto.split(' ');
            const nombreCmd = partes[1]?.toLowerCase();
            const respuestaCmd = partes.slice(2).join(' ');

            if (!nombreCmd || !respuestaCmd) {
                await sock.sendMessage(jid, { 
                    text: '⚠️ *Uso correcto:* `.addcmd .comando Tu respuesta personalizada aquí`' 
                }, { quoted: msg });
                return;
            }

            comandosPersonalizados[nombreCmd] = respuestaCmd;
            guardarComandos(comandosPersonalizados);

            await sock.sendMessage(jid, { text: `✅ *Comando guardado con éxito:* \`${nombreCmd}\`` }, { quoted: msg });
            return;
        }

        if (texto.toLowerCase().startsWith('.delcmd')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const nombreCmd = texto.split(' ')[1]?.toLowerCase();
            if (!nombreCmd || !comandosPersonalizados[nombreCmd]) {
                await sock.sendMessage(jid, { text: '⚠️ Comando no encontrado o mal escrito.' }, { quoted: msg });
                return;
            }

            delete comandosPersonalizados[nombreCmd];
            guardarComandos(comandosPersonalizados);

            await sock.sendMessage(jid, { text: `🗑️ *Comando eliminado:* \`${nombreCmd}\`` }, { quoted: msg });
            return;
        }

        if (texto.toLowerCase() === '.miscomandos') {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const lista = Object.keys(comandosPersonalizados);
            if (lista.length === 0) {
                await sock.sendMessage(jid, { text: '📋 Aún no has creado comandos personalizados.' }, { quoted: msg });
                return;
            }

            const respuesta = `📋 *COMANDOS PERSONALIZADOS ACTIVOS:*\n\n` + lista.map(c => `• \`${c}\``).join('\n');
            await sock.sendMessage(jid, { text: respuesta }, { quoted: msg });
            return;
        }

        // ==========================================
        // EJECUCIÓN DE COMANDOS PERSONALIZADOS
        // ==========================================
        const primerPalabra = texto.split(' ')[0].toLowerCase();
        if (comandosPersonalizados[primerPalabra]) {
            await sock.sendMessage(jid, { text: comandosPersonalizados[primerPalabra] }, { quoted: msg });
            return;
        }

        // ==========================================
        // COMANDOS BASE FIJOS
        // ==========================================
        if (texto.toLowerCase() === '.menu' || texto.toLowerCase() === '.ayuda') {
            const menu = 
`🤖 *MENÚ DE ASISTENCIA — CLICK&CUT*

Escribe cualquiera de los siguientes comandos:

🔹 *.codigo [servicio]* ➔ PIN o acceso temporal en tu TV.
🔹 *.reporte [falla]* ➔ Generar ticket por cuenta caída.
🔹 *.pagos* ➔ Datos bancarios y métodos de pago.
🔹 *.tramites* ➔ Catálogo de trámites y gestiones digitales.
🔹 *.reglas* ➔ Políticas de uso y garantías.
🔹 *.horario* ➔ Horarios de atención.`;
            await sock.sendMessage(jid, { text: menu }, { quoted: msg });
        }

        else if (texto.toLowerCase().startsWith('.codigo')) {
            const servicio = texto.split(' ').slice(1).join(' ') || 'tu cuenta';
            const respuesta = 
`🔐 *SOLICITUD DE CÓDIGO TEMPORAL*
👤 *Cliente:* @${remitenteNum}
📺 *Servicio:* ${servicio.toUpperCase()}

⚠️ *Instrucciones:* Mantén la pantalla visible en tu TV. Un administrador te enviará el acceso en breve.`;
            await sock.sendMessage(jid, { text: respuesta, mentions: [sender] }, { quoted: msg });
        }

        else if (texto.toLowerCase().startsWith('.reporte')) {
            const detalle = texto.split(' ').slice(1).join(' ');
            if (!detalle) {
                await sock.sendMessage(jid, { text: '⚠️ Escribe: `.reporte [Servicio] [Problema]`' }, { quoted: msg });
                return;
            }
            const respuesta = 
`🛠️ *TICKET DE SOPORTE*
👤 *Usuario:* @${remitenteNum}
📌 *Detalle:* ${detalle}
⏳ *Estado:* En cola de revisión`;
            await sock.sendMessage(jid, { text: respuesta, mentions: [sender] }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.pagos' || texto.toLowerCase() === '.renovar') {
            const pagos = 
`💳 *MÉTODOS DE PAGO — CLICK&CUT*
🏦 *Transferencia (SPEI):* Solicita la cuenta a un admin.
📱 *Mercado Pago / OXXO:* Solicitar enlace por privado.`;
            await sock.sendMessage(jid, { text: pagos }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.tramites') {
            const tramites = 
`📄 *TRÁMITES DIGITALES — CLICK&CUT*
• Actas de Nacimiento, Matrimonio, Defunción
• Consultas CURP / RFC
• Citas y formatos en línea`;
            await sock.sendMessage(jid, { text: tramites }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.reglas' || texto.toLowerCase() === '.garantia') {
            const reglas = `📜 *POLÍTICAS:* Prohibido cambiar contraseñas, correos o perfiles ajenos. Uso solo en las pantallas contratadas.`;
            await sock.sendMessage(jid, { text: reglas }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.horario') {
            const horario = `⏰ *HORARIO:* Lunes a Sábado de 9:00 AM a 10:00 PM.`;
            await sock.sendMessage(jid, { text: horario }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.cerrar') {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;
            try {
                await sock.groupSettingUpdate(jid, 'announcement');
                await sock.sendMessage(jid, { text: '🔒 *GRUPO CERRADO POR HORARIO*' });
            } catch (err) {
                await sock.sendMessage(jid, { text: '⚠️ El bot debe ser administrador del grupo.' }, { quoted: msg });
            }
        }

        else if (texto.toLowerCase() === '.abrir') {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;
            try {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                await sock.sendMessage(jid, { text: '🔓 *GRUPO ABIERTO*' });
            } catch (err) {
                await sock.sendMessage(jid, { text: '⚠️ El bot debe ser administrador del grupo.' }, { quoted: msg });
            }
        }

        else if (texto.toLowerCase().startsWith('.aviso')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;
            const com = texto.split(' ').slice(1).join(' ');
            if (com) await sock.sendMessage(jid, { text: `📢 *COMUNICADO OFICIAL*\n\n${com}` });
        }

        else if (texto.toLowerCase().startsWith('.todos') || texto.toLowerCase().startsWith('.tagall')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;
            const msj = texto.split(' ').slice(1).join(' ') || 'Atención grupo';
            const metadata = await sock.groupMetadata(jid);
            const participantes = metadata.participants.map(p => p.id);
            let menciones = `🔔 *NOTIFICACIÓN GENERAL*\n\n${msj}\n\n
