const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Servidor express para Render
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot Click&Cut activo 🟢'));
app.listen(port, () => console.log(`Servidor web activo en puerto ${port}`));

// Número formateado para WhatsApp México (código 52 + 10 dígitos)
const NUMERO_TELEFONO = '528641062059';

// Archivo para almacenar comandos personalizados
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

    // Solicitar código numérico si aún no está vinculado
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const codigo = await sock.requestPairingCode(NUMERO_TELEFONO);
                console.log('\n=========================================');
                console.log(`🔑 TU CÓDIGO DE VINCULACIÓN ES: ${codigo}`);
                console.log('=========================================\n');
            } catch (error) {
                console.error('Error al generar pairing code:', error);
            }
        }, 4000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando:', reconectar);
            if (reconectar) iniciarBot();
        } else if (connection === 'open') {
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

        // --- COMANDOS DINÁMICOS DESDE CHAT ---
        if (texto.toLowerCase().startsWith('.addcmd')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const partes = texto.split(' ');
            const nombreCmd = partes[1]?.toLowerCase();
            const respuestaCmd = partes.slice(2).join(' ');

            if (!nombreCmd || !respuestaCmd) {
                await sock.sendMessage(jid, { 
                    text: '⚠️ *Uso:* `.addcmd .comando Respuesta del bot`' 
                }, { quoted: msg });
                return;
            }

            comandosPersonalizados[nombreCmd] = respuestaCmd;
            guardarComandos(comandosPersonalizados);

            await sock.sendMessage(jid, { text: `✅ Comando guardado: \`${nombreCmd}\`` }, { quoted: msg });
            return;
        }

        if (texto.toLowerCase().startsWith('.delcmd')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const nombreCmd = texto.split(' ')[1]?.toLowerCase();
            if (!nombreCmd || !comandosPersonalizados[nombreCmd]) {
                await sock.sendMessage(jid, { text: '⚠️ Comando no encontrado.' }, { quoted: msg });
                return;
            }

            delete comandosPersonalizados[nombreCmd];
            guardarComandos(comandosPersonalizados);

            await sock.sendMessage(jid, { text: `🗑️ Comando eliminado: \`${nombreCmd}\`` }, { quoted: msg });
            return;
        }

        if (texto.toLowerCase() === '.miscomandos') {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const lista = Object.keys(comandosPersonalizados);
            if (lista.length === 0) {
                await sock.sendMessage(jid, { text: '📋 No hay comandos personalizados activos.' }, { quoted: msg });
                return;
            }

            const respuesta = `📋 *COMANDOS ACTIVOS:*\n\n` + lista.map(c => `• \`${c}\``).join('\n');
            await sock.sendMessage(jid, { text: respuesta }, { quoted: msg });
            return;
        }

        // Ejecución de comando dinámico
        const primerPalabra = texto.split(' ')[0].toLowerCase();
        if (comandosPersonalizados[primerPalabra]) {
            await sock.sendMessage(jid, { text: comandosPersonalizados[primerPalabra] }, { quoted: msg });
            return;
        }

        // --- COMANDOS FIJOS ---
        if (texto.toLowerCase() === '.menu' || texto.toLowerCase() === '.ayuda') {
            const menu = 
`🤖 *MENÚ DE ASISTENCIA — CLICK&CUT*

🔹 *.codigo [servicio]* ➔ Solicitar PIN o acceso en TV.
🔹 *.reporte [falla]* ➔ Generar ticket de soporte.
🔹 *.pagos* ➔ Ver cuentas de transferencia.
🔹 *.tramites* ➔ Catálogo de trámites digitales.
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

⚠️ *Instrucciones:* Mantén visible la pantalla en tu TV. Un administrador te enviará el acceso en breve.`;
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
🏦 *Transferencia (SPEI):* Banco / CLABE
📱 *Mercado Pago / OXXO:* Solicitar datos por privado.`;
            await sock.sendMessage(jid, { text: pagos }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.tramites') {
            const tramites = 
`📄 *TRÁMITES DIGITALES — CLICK&CUT*
• Actas de Nacimiento, Matrimonio, Defunción
• Consultas CURP / RFC
• Citas y gestiones en línea`;
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
    });
}

iniciarBot();
