const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const express = require('express');

// Servidor express para que Render mantenga el servicio activo
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot Click&Cut activo 🟢'));
app.listen(port, () => console.log(`Servidor web escuchando en el puerto ${port}`));

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_soporte');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Mostrar QR en consola
        if (qr) {
            console.log('\n--- ESCANEA ESTE CÓDIGO QR CON WHATSAPP ---\n');
            qrcode.generate(qr, { small: true });
        }

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

        // COMANDOS CLIENTES
        if (texto.toLowerCase() === '.menu' || texto.toLowerCase() === '.ayuda') {
            const menu = 
`🤖 *MENÚ DE ASISTENCIA — CLICK&CUT*

Escribe cualquiera de los siguientes comandos en el chat:

🔹 *.codigo [servicio]* ➔ Solicitar PIN o acceso temporal en tu TV.
🔹 *.reporte [falla]* ➔ Levantar ticket por cuenta caída o error.
🔹 *.pagos* ➔ Ver cuentas de transferencia y métodos de pago.
🔹 *.tramites* ➔ Catálogo de trámites y gestiones digitales.
🔹 *.reglas* ➔ Políticas de uso y garantías de los perfiles.
🔹 *.horario* ➔ Horarios de atención y soporte.

📌 *Por favor, utiliza los comandos para mantener el grupo ordenado.*`;
            await sock.sendMessage(jid, { text: menu }, { quoted: msg });
        }

        else if (texto.toLowerCase().startsWith('.codigo')) {
            const servicio = texto.split(' ').slice(1).join(' ') || 'tu cuenta';
            const respuesta = 
`🔐 *SOLICITUD DE CÓDIGO TEMPORAL*

👤 *Cliente:* @${remitenteNum}
📺 *Servicio:* ${servicio.toUpperCase()}

⚠️ *Instrucciones obligatorias:*
1. No cierres ni muevas la pantalla en tu TV o dispositivo.
2. Mantén visible la pantalla donde pide el código de 4 dígitos o el enlace.
3. En breve un administrador te enviará el acceso. Los códigos vencen rápido, ¡mantente atento!`;
            await sock.sendMessage(jid, { text: respuesta, mentions: [sender] }, { quoted: msg });
        }

        else if (texto.toLowerCase().startsWith('.reporte')) {
            const detalle = texto.split(' ').slice(1).join(' ');
            if (!detalle) {
                await sock.sendMessage(jid, { 
                    text: `⚠️ *Formato incorrecto.*\nEscribe: \`.reporte [Servicio] [Problema detallado]\`` 
                }, { quoted: msg });
                return;
            }
            const respuesta = 
`🛠️ *TICKET DE SOPORTE GENERADO*

👤 *Usuario:* @${remitenteNum}
📌 *Detalle:* ${detalle}
⏳ *Estado:* En cola de revisión

✅ *Tu reporte fue registrado con éxito. Un administrador revisará la cuenta a la brevedad.*`;
            await sock.sendMessage(jid, { text: respuesta, mentions: [sender] }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.pagos' || texto.toLowerCase() === '.renovar') {
            const pagos = 
`💳 *MÉTODOS DE PAGO DISPONIBLES — CLICK&CUT*

🏦 *Transferencia Directa (SPEI):*
• Banco: [Tu Banco]
• CLABE: \`[Tu CLABE Aquí]\`
• Titular: [Tu Nombre]

📱 *Mercado Pago / OXXO:* Solicitar enlace por privado.`;
            await sock.sendMessage(jid, { text: pagos }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.tramites') {
            const tramites = 
`📄 *TRÁMITES Y SERVICIOS DIGITALES — CLICK&CUT*

Realizamos gestiones oficiales y asistencia en línea:
• Impresión y descarga de Actas (Nacimiento, Matrimonio, Defunción).
• Consultas y correcciones de CURP / RFC con homoclave.
• Citas oficiales y seguimiento de plataformas gubernamentales.
• Formatos, registros educativos y solicitudes en línea.`;
            await sock.sendMessage(jid, { text: tramites }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.reglas' || texto.toLowerCase() === '.garantia') {
            const reglas = 
`📜 *POLÍTICAS DE GARANTÍA Y USO — CLICK&CUT*

1. *1 Pantalla / Perfil:* Solo en los dispositivos contratados.
2. *Datos Intocables:* Prohibido cambiar contraseñas, correos o perfiles ajenos.
3. *Violación:* Modificar datos anula la garantía de inmediato.`;
            await sock.sendMessage(jid, { text: reglas }, { quoted: msg });
        }

        else if (texto.toLowerCase() === '.horario') {
            const horario = 
`⏰ *HORARIOS DE ATENCIÓN Y SOPORTE*

• *Lunes a Sábado:* 9:00 AM – 10:00 PM
• *Domingos:* Turno de guardia y entregas programadas.`;
            await sock.sendMessage(jid, { text: horario }, { quoted: msg });
        }

        // COMANDOS ADMIN
        else if (texto.toLowerCase() === '.cerrar') {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;
            try {
                await sock.groupSettingUpdate(jid, 'announcement');
                await sock.sendMessage(jid, { text: '🔒 *GRUPO CERRADO POR HORARIO*\n\nEl chat entra en modo descanso. Solo los administradores pueden enviar mensajes.' });
            } catch (err) {
                await sock.sendMessage(jid, { text: '⚠️ *Error:* Asegúrate de que el bot sea administrador del grupo.' }, { quoted: msg });
            }
        }

        else if (texto.toLowerCase() === '.abrir') {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;
            try {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                await sock.sendMessage(jid, { text: '🔓 *GRUPO ABIERTO — BUENOS DÍAS*\n\nEl chat está habilitado para solicitudes y soporte.' });
            } catch (err) {
                await sock.sendMessage(jid, { text: '⚠️ *Error:* Asegúrate de que el bot sea administrador del grupo.' }, { quoted: msg });
            }
        }

        else if (texto.toLowerCase().startsWith('.aviso')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;
            const comunicado = texto.split(' ').slice(1).join(' ');
            if (!comunicado) return;
            await sock.sendMessage(jid, { text: `📢 *COMUNICADO OFICIAL — CLICK&CUT*\n\n${comunicado}` });
        }

        else if (texto.toLowerCase().startsWith('.todos') || texto.toLowerCase().startsWith('.tagall')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;
            const mensaje = texto.split(' ').slice(1).join(' ') || 'Atención grupo';
            const metadata = await sock.groupMetadata(jid);
            const participantes = metadata.participants.map(p => p.id);
            let menciones = `🔔 *NOTIFICACIÓN GENERAL*\n\n${mensaje}\n\n`;
            for (const p of metadata.participants) {
                menciones += `@${p.id.split('@')[0]} `;
            }
            await sock.sendMessage(jid, { text: menciones, mentions: participantes });
        }
    });
}

iniciarBot();
