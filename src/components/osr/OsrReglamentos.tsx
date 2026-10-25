// Reglamento básico y avanzado de "¿Quién es tu papi?" -- el avanzado
// tiene que coincidir EXACTO con la lógica que corre en
// supabase/migration_214_osr_quien_es_tu_papi.sql (osr_calcular_puntos,
// osr_paternidades_*, osr_titulo_padrastro): si una regla cambia acá,
// tiene que cambiar también ahí, y viceversa.

export function OsrReglamentoBasico() {
  return (
    <div className="osr-reglamento">
      <h3 className="section-title">Reglamento básico</h3>
      <ol>
        <li>
          <strong>Objetivo:</strong> competir 1v1 contra otros integrantes del clan, acumular MMR del evento y volverse Papi de
          alguien (o de todos).
        </li>
        <li>
          <strong>Cómo reportar una partida:</strong> jugá tu partida normal de SC2 contra otro inscripto, y pedile a un moderador
          que la registre (con la repetición o alguna evidencia si hace falta).
        </li>
        <li>
          <strong>No hace falta BO3:</strong> cada juego individual cuenta por separado. Jugaste y ganaste un solo mapa, ya suma
          puntos.
        </li>
        <li>
          <strong>Cómo se gana o pierde MMR:</strong> ganar siempre suma puntos y perder siempre resta, pero cuánto depende de la
          categoría del rival -- ver el Reglamento avanzado para la tabla exacta.
        </li>
        <li>
          <strong>Por qué importa la categoría del rival:</strong> ganarle a alguien de una categoría más alta vale más puntos que
          ganarle a alguien de una categoría más baja; perder contra alguien de categoría más baja duele más.
        </li>
        <li>
          <strong>Tener un papá:</strong> si alguien te gana por 3 partidas netas de diferencia o más, es tu papá. Si vos le ganás a
          él por esa misma diferencia, el papá sos vos.
        </li>
        <li>
          <strong>Disputar paternidad:</strong> si la diferencia de victorias entre dos jugadores es menor a 3, todavía no hay papá
          -- la relación está "disputando paternidad".
        </li>
        <li>
          <strong>Cómo se obtienen los títulos:</strong> se calculan solos, automáticamente, a partir de los resultados verificados
          -- nadie se los auto-otorga.
        </li>
        <li>
          <strong>Papi Dios</strong>: el 1° del ranking Global. <strong>Papi</strong>: el 1° de tu categoría.{" "}
          <strong>Papi Regador</strong>: quien tiene más hijos distintos. <strong>Padrastro</strong>: quien le saca 10 victorias o
          más de ventaja a un mismo rival. <strong>Mascota del Clan</strong>: quien tiene el MMR del evento más bajo.
        </li>
        <li>
          <strong>Rankings:</strong> hay uno por categoría, uno Global (todas juntas) y uno por raza principal.
        </li>
        <li>
          <strong>Resultados verificables:</strong> un moderador tiene que poder confirmar que la partida existió de verdad.
        </li>
        <li>
          <strong>Partidas pendientes:</strong> no suman ni restan nada hasta que un moderador las marca como verificadas.
        </li>
      </ol>
    </div>
  );
}

export function OsrReglamentoAvanzado() {
  return (
    <div className="osr-reglamento">
      <h3 className="section-title">Reglamento avanzado</h3>

      <h4>MMR oficial vs. MMR del evento</h4>
      <p>
        El MMR oficial es el de StarCraft II (verificado por el moderador, ej. vía SC2 Pulse) y solo se usa UNA VEZ, al empezar la
        temporada, para asignar tu categoría. El MMR del evento es independiente, arranca en 0 cada temporada nueva, y se mueve
        únicamente con los resultados de este evento.
      </p>

      <h4>Categorías</h4>
      <p>3500 (hasta 3500) · 4000 (3501-4000) · 4500 (4001-4500) · 5000 (4501-5000) · 5500 (5001-5500) · Sin límite (más de 5500).</p>
      <p>La categoría queda fija toda la temporada, sin importar cómo varíe tu MMR oficial mientras tanto.</p>

      <h4>Tabla de puntos por diferencia de categoría</h4>
      <table className="group-standings-table ranking-table osr-tabla-puntos">
        <thead>
          <tr>
            <th>Categoría del rival</th>
            <th>Si ganás</th>
            <th>Si perdés</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>4 o 5 categorías inferiores</td>
            <td>+1</td>
            <td>-8</td>
          </tr>
          <tr>
            <td>3 categorías inferiores</td>
            <td>+1</td>
            <td>-7</td>
          </tr>
          <tr>
            <td>2 categorías inferiores</td>
            <td>+2</td>
            <td>-6</td>
          </tr>
          <tr>
            <td>1 categoría inferior</td>
            <td>+3</td>
            <td>-5</td>
          </tr>
          <tr>
            <td>Misma categoría</td>
            <td>+5</td>
            <td>-5</td>
          </tr>
          <tr>
            <td>1 categoría superior</td>
            <td>+7</td>
            <td>-3</td>
          </tr>
          <tr>
            <td>2 categorías superiores</td>
            <td>+9</td>
            <td>-2</td>
          </tr>
          <tr>
            <td>3 categorías superiores</td>
            <td>+11</td>
            <td>-1</td>
          </tr>
          <tr>
            <td>4 o 5 categorías superiores</td>
            <td>+13</td>
            <td>-1</td>
          </tr>
        </tbody>
      </table>
      <p>El MMR del evento nunca baja de 0. Cada partida verificada aplica estos puntos a ambos jugadores, una sola vez.</p>

      <h4>Registro y corrección de partidas</h4>
      <p>
        Cada partida queda en estado pendiente, verificada, rechazada o corregida. Solo las verificadas afectan el MMR y los
        rankings. Si un moderador corrige o elimina una partida verificada, se recalcula TODO el MMR de la temporada desde cero,
        reproduciendo en orden cronológico todas las partidas que sigan verificadas -- así nunca queda un número "a mitad de
        camino".
      </p>
      <p>No se permite registrar la misma partida dos veces ni enfrentamientos de un jugador contra sí mismo.</p>

      <h4>Verificación</h4>
      <p>
        La fuente principal de verificación es SC2 Pulse (sc2pulse.nephest.com). Si una partida no aparece ahí, no significa que
        sea falsa -- el moderador puede aceptar una repetición u otra evidencia verificable.
      </p>

      <h4>Paternidades</h4>
      <p>
        Se calculan exclusivamente por victorias directas entre dos jugadores, cruzando TODAS las temporadas (no se reinician).
        Si A le gana a B por 3 o más partidas de diferencia neta, A es el papá de B. Con menos de 3 de diferencia, la relación es
        "disputando paternidad". Un mismo rival cuenta una sola vez en la lista de hijos, sin importar cuántas veces le hayas
        ganado.
      </p>

      <h4>Padrastro</h4>
      <p>
        Requiere una ventaja neta de al menos 10 victorias sobre UN MISMO rival (no se suman ventajas contra rivales distintos).
        Solo puede haber un titular. Desempate, en este orden: mayor diferencia neta, más victorias directas contra ese rival,
        mayor MMR del evento. Si persiste el empate, lo resuelve el moderador a mano.
      </p>

      <h4>Etiquetas y sus Top 5</h4>
      <ul>
        <li>Papi Dios: 1° del ranking Global por MMR del evento (empate = título compartido).</li>
        <li>Papi: 1° de cada categoría por MMR del evento (empate = título compartido, por categoría).</li>
        <li>Papi Regador: mayor cantidad de hijos consolidados distintos.</li>
        <li>Padrastro: ver arriba.</li>
        <li>Mascota del Clan: menor MMR del evento; empate se desempata por mayor cantidad de padres.</li>
      </ul>

      <h4>Ranking de razas</h4>
      <p>
        Se arma por raza principal registrada en el evento (puede diferir de la raza principal en otros sistemas de RemorApp). Los
        títulos de raza se deciden por la SUMA total de MMR del evento de todos sus integrantes, no por el promedio -- el promedio
        es solo informativo.
      </p>

      <h4>Temporadas</h4>
      <p>
        Una nueva temporada reinicia el MMR del evento (a 0) y reasigna categorías según el MMR oficial vigente, pero NO borra el
        historial de partidas ni las paternidades -- la paternidad histórica se sigue pudiendo consultar cruzando todas las
        temporadas.
      </p>

      <h4>Permisos y auditoría</h4>
      <p>
        Solo quienes están en la lista de moderadores de este evento (o el dueño del equipo) pueden registrar, verificar, corregir
        o rechazar partidas, dar de alta jugadores o administrar temporadas. Toda acción administrativa queda registrada con quién
        la hizo, cuándo, y qué cambió.
      </p>
    </div>
  );
}
