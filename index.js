const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
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

// ⚠️ Tu número para vincular con código (con clave de país, ej. 521XXXXXXXXXX)
const NUMERO_TELEFONO = '521XXXXXXXXXX';

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
        browser: ['Ubuntu', 'Chrome', '20.0.04']
    });

    sock.ev.on('creds.update', saveCreds);

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
        }, 3000);
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

        // ==========================================
        // ADMINISTRAR COMANDOS DESDE WHATSAPP
        // ==========================================

        // Crear/Editar comando: .addcmd .nombreComando Respuesta que dará el bot
        if (texto.toLowerCase().startsWith('.addcmd')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const partes = texto.split(' ');
            const nombreCmd = partes[1]?.toLowerCase();
            const respuestaCmd = partes.slice(2).join(' ');

            if (!nombreCmd || !respuestaCmd) {
                await sock.sendMessage(jid, { 
                    text: '⚠️ *Uso correcto:* `.addcmd .nombrecomando Respuesta del bot`\n_Ejemplo: .addcmd .disney Cuenta Disney 1 pantalla $40_' 
                }, { quoted: msg });
                return;
            }

            comandosPersonalizados[nombreCmd] = respuestaCmd;
            guardarComandos(comandosPersonalizados);

            await sock.sendMessage(jid, { text: `✅ *Comando guardado con éxito:* \`${nombreCmd}\`` }, { quoted: msg });
            return;
        }

        // Eliminar comando: .delcmd .nombreComando
        if (texto.toLowerCase().startsWith('.delcmd')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const nombreCmd = texto.split(' ')[1]?.toLowerCase();
            if (!nombreCmd || !comandosPersonalizados[nombreCmd]) {
                await sock.sendMessage(jid, { text: '⚠️ Ese comando no existe o no se especificó.' }, { quoted: msg });
                return;
            }

            delete comandosPersonalizados[nombreCmd];
            guardarComandos(comandosPersonalizados);

            await sock.sendMessage(jid, { text: `🗑️ *Comando eliminado:* \`${nombreCmd}\`` }, { quoted: msg });
            return;
        }

        // Ver lista de comandos personalizados: .miscomandos
        if (texto.toLowerCase() === '.miscomandos') {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const lista = Object.keys(comandosPersonalizados);
            if (lista.length === 0) {
                await sock.sendMessage(jid, { text: '📋 No tienes comandos dinámicos creados todavía.' }, { quoted: msg });
                return;
            }

            const respuesta = `📋 *COMANDOS PERSONALIZADOS ACTIVOS:*\n\n` + lista.map(c => `• \`${c}\``).join('\n');
            await sock.sendMessage(jid, { text: respuesta }, { quoted: msg });
            return;
        }

        // ==========================================
        // EJECUTAR COMANDOS DINÁMICOS
        // ==========================================
        const primerPalabra = texto.split(' ')[0].toLowerCase();
        if (comandosPersonalizados[primerPalabra]) {
            await sock.sendMessage(jid, { text: comandosPersonalizados[primerPalabra] }, { quoted: msg });
            return;
        }

        // ==========================================
        // COMANDOS BASE FIJOS (Soporte, Apertura, Cierre)
        // ==========================================
        if (texto.toLowerCase() === '.menu' || texto.toLowerCase() === '.ayuda') {
            const menu = 
`🤖 *MENÚ DE ASISTENCIA — CLICK&CUT*

🔹 *.codigo [servicio]* ➔ Solicitar PIN o acceso en TV.
🔹 *.reporte [falla]* ➔ Generar ticket de soporte.
🔹 *.pagos* ➔ Ver cuentas de transferencia.
🔹 *.tramites* ➔ Trámites digitales disponibles.
🔹 *.reglas* ➔ Políticas de garantía.
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
                await sock.sendMessage(jid, { text: '⚠️ Escribe: `.reporte [Servicio] [Problema detallado]`' }, { quoted: msg });
                return;
            }
            const respuesta = 
`🛠️ *TICKET DE SOPORTE*
👤 *Usuario:* @${remitenteNum}
📌 *Detalle:* ${detalle}
⏳ *Estado:* En cola de revisión`;
            await sock.sendMessage(jid, { text: respuesta, mentions: [sender] }, { quoted: msg });
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
