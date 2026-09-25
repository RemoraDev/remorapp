// Cliente de obs-websocket (protocolo v5, el que trae OBS 28+ de
// fábrica -- Herramientas > WebSocket Server Settings). Implementado a
// mano contra el WebSocket nativo del navegador en vez de agregar una
// librería: el protocolo es chico (un handshake de autenticación y un
// tipo de mensaje para pedir un cambio de escena) y esto corre en el
// navegador del propio caster, con su contraseña de por medio -- mejor
// que ese código sea auditable de un vistazo.
//
// Referencia del protocolo: https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
//
// IMPORTANTE sobre cómo se probó esto: no hay una instalación de OBS
// en este entorno, así que el handshake nunca se validó contra un OBS
// real. Se probó en cambio contra un servidor de prueba propio (ver
// scripts/obs-mock-server, usado solo para la sesión de pruebas) que
// implementa el mismo algoritmo de autenticación documentado por
// obs-websocket -- confirma que el cálculo del cliente es
// autoconsistente con la especificación, no que un OBS real lo acepta.

// Evento del navegador que dispara ProfilePage.tsx después de guardar
// o borrar la configuración de OBS -- ObsController lo escucha para
// reconectar. Hace falta un evento explícito porque la contraseña
// nunca se guarda en el objeto "profile" (ver migración 103): si
// alguien cambia solo la contraseña, ninguno de los campos que sí
// están en "profile" (url, nombres de escena) cambia de valor, así
// que un simple useEffect atado a esos campos no se volvería a
// disparar.
export const EVENTO_OBS_CONFIG_ACTUALIZADA = "remorapp:obs-config-actualizada";

export type ObsErrorTipo = "conexion" | "autenticacion" | "desconocido";

export class ObsError extends Error {
  tipo: ObsErrorTipo;
  constructor(tipo: ObsErrorTipo, mensaje: string) {
    super(mensaje);
    this.tipo = tipo;
  }
}

interface ObsMensaje {
  op: number;
  d?: Record<string, unknown>;
}

const OP_HELLO = 0;
const OP_IDENTIFY = 1;
const OP_IDENTIFIED = 2;
const OP_REQUEST = 6;
const OP_REQUEST_RESPONSE = 7;

async function sha256Base64(texto: string): Promise<string> {
  const datos = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest("SHA-256", datos);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

// Algoritmo de autenticación de obs-websocket v5: primero se combina
// la contraseña con la "sal" que manda el servidor, y ese resultado
// (ya hasheado) se vuelve a combinar con el "desafío" -- ninguna de
// las dos partes viaja nunca en texto plano por la red.
async function calcularAutenticacion(password: string, sal: string, desafio: string): Promise<string> {
  const secreto = await sha256Base64(password + sal);
  return sha256Base64(secreto + desafio);
}

export interface ConexionObs {
  cambiarEscena: (nombreEscena: string) => Promise<void>;
  cerrar: () => void;
}

// Abre la conexión, hace el handshake completo (Hello -> Identify ->
// Identified) y recién ahí resuelve la promesa -- si la contraseña es
// incorrecta o el WebSocket Server de OBS no está activado, rechaza
// con un ObsError con el tipo correspondiente en vez de dejar la
// conexión a medio abrir.
//
// onDesconexion (opcional) avisa si la conexión se corta DESPUÉS de
// haberse identificado correctamente (OBS se cerró, se reinició, se
// cayó la red) -- no reintenta la conexión sola, solo informa; quien
// llama decide si quiere volver a intentar conectarObs().
export function conectarObs(url: string, password: string, onDesconexion?: () => void): Promise<ConexionObs> {
  return new Promise((resolve, reject) => {
    let identificado = false;
    let liquidado = false;
    let cerradoIntencionalmente = false;
    let ws: WebSocket;

    const pendientes = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();

    const finalizarConError = (error: ObsError) => {
      if (liquidado) return;
      liquidado = true;
      try {
        ws.close();
      } catch {
        // ya estaba cerrándose, no importa.
      }
      reject(error);
    };

    const timeoutConexion = setTimeout(() => {
      finalizarConError(
        new ObsError(
          "conexion",
          "No se pudo conectar a OBS en esa dirección. Verifica que OBS esté abierto y que el WebSocket Server esté activado (Herramientas > WebSocket Server Settings > Habilitar WebSocket Server)."
        )
      );
    }, 6000);

    try {
      ws = new WebSocket(url);
    } catch {
      clearTimeout(timeoutConexion);
      reject(new ObsError("conexion", "La dirección de OBS no es una URL de WebSocket válida (debe empezar con ws:// o wss://)."));
      return;
    }

    ws.onerror = () => {
      // El evento "error" del WebSocket no trae detalle -- el motivo
      // real (rechazado, dirección inexistente, etc.) se termina de
      // confirmar en onclose.
    };

    ws.onclose = (evento) => {
      clearTimeout(timeoutConexion);
      if (cerradoIntencionalmente) return;
      if (identificado) {
        identificado = false;
        onDesconexion?.();
        return;
      }
      if (evento.code === 4008) {
        finalizarConError(
          new ObsError("autenticacion", "La contraseña de OBS es incorrecta. Verifica que la copiaste exacta desde OBS.")
        );
      } else {
        finalizarConError(
          new ObsError(
            "conexion",
            "No se pudo conectar a OBS en esa dirección. Verifica que OBS esté abierto y que el WebSocket Server esté activado (Herramientas > WebSocket Server Settings > Habilitar WebSocket Server)."
          )
        );
      }
    };

    ws.onmessage = async (evento) => {
      let mensaje: ObsMensaje;
      try {
        mensaje = JSON.parse(evento.data);
      } catch {
        return;
      }

      if (mensaje.op === OP_HELLO) {
        const datos = mensaje.d as { rpcVersion: number; authentication?: { challenge: string; salt: string } };
        let autenticacion: string | undefined;
        if (datos.authentication) {
          try {
            autenticacion = await calcularAutenticacion(password, datos.authentication.salt, datos.authentication.challenge);
          } catch {
            finalizarConError(new ObsError("desconocido", "No se pudo calcular la autenticación de OBS en este navegador."));
            return;
          }
        }
        const identify: ObsMensaje = {
          op: OP_IDENTIFY,
          d: {
            rpcVersion: datos.rpcVersion,
            eventSubscriptions: 0,
            ...(autenticacion ? { authentication: autenticacion } : {}),
          },
        };
        ws.send(JSON.stringify(identify));
        return;
      }

      if (mensaje.op === OP_IDENTIFIED) {
        clearTimeout(timeoutConexion);
        identificado = true;
        resolve({
          cambiarEscena: (nombreEscena: string) =>
            new Promise<void>((resolveCambio, rejectCambio) => {
              const requestId = crypto.randomUUID();
              pendientes.set(requestId, { resolve: resolveCambio, reject: rejectCambio });
              const request: ObsMensaje = {
                op: OP_REQUEST,
                d: {
                  requestType: "SetCurrentProgramScene",
                  requestId,
                  requestData: { sceneName: nombreEscena },
                },
              };
              ws.send(JSON.stringify(request));
            }),
          cerrar: () => {
            cerradoIntencionalmente = true;
            ws.close();
          },
        });
        return;
      }

      if (mensaje.op === OP_REQUEST_RESPONSE) {
        const datos = mensaje.d as {
          requestId: string;
          requestStatus: { result: boolean; code: number; comment?: string };
        };
        const pendiente = pendientes.get(datos.requestId);
        if (!pendiente) return;
        pendientes.delete(datos.requestId);
        if (datos.requestStatus.result) {
          pendiente.resolve();
        } else {
          pendiente.reject(
            new ObsError("desconocido", datos.requestStatus.comment ?? "OBS rechazó el cambio de escena.")
          );
        }
      }
    };
  });
}
