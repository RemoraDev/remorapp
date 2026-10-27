# Hito 2 del motor de fondos — nubes volumétricas y la luna como luz

Capturas a 1600x900, tomadas con:

```
node scripts/capturar-motor.mjs docs/capturas/hito-2 "nombre=parametros"
```

(con `npm run dev` corriendo). Para mirar cualquiera de estas escenas en
vivo: `http://localhost:5173/scripts/motor/index.html?<parametros>`.

## Qué mirar en cada una

| Archivo | Parámetros | Qué demuestra |
|---|---|---|
| `01-mediodia` | `hora=12&nubes=0.5` | Cúmulos con base plana y tope abollonado, con claros de cielo azul entre bancos. |
| `02-tarde` | `hora=17.0&nubes=0.5` | Luz lateral: un lado del cúmulo iluminado y el otro en su propia sombra. |
| `03-sol-bajo` | `hora=18.1&nubes=0.5` | **Bajos anaranjados y rojos.** No hay ningún color pintado a mano: sale de que la misma transmitancia atmosférica que enrojece el sol atenúa la luz que llega a la nube. Se ve además el sol y la luna a la vez, que es lo que pasa de verdad. |
| `04-crepusculo` | `hora=18.8&nubes=0.5` | Sol bajo el horizonte; la capa queda contra el azul profundo. |
| `05-noche-luna-llena` | `hora=1&fase=1&horaLuna=7` | **La luna como fuente de luz.** Las nubes están iluminadas desde su dirección, con sombra propia del lado opuesto, y el cielo tiene su propio halo azul dispersado. |
| `06-noche-cuarto` | `fase=0.45` | La fase cambia la forma del disco **y** cuánta luz hay en la escena. |
| `07-noche-sin-luna` | `fase=0.02` | Noche cerrada: sin luna no hay a qué iluminarse. |
| `08-nubes-pocas` | `nubes=0.28` | Cielo casi despejado. |
| `09-nubes-cubierto` | `nubes=0.85` | Techo cubierto con un claro. |
| `10-luna-contraluz` | `horaLuna=6.6&nubes=0.62` | **Bordes plateados.** Con la luna detrás de la nube, el lóbulo frontal de la fase de Henyey-Greenstein enciende el contorno. Es el efecto que hace falta para Ashenvale. |

## Lo que se construyó

- **Volúmenes de ruido horneados en compute al arrancar**
  (`src/motor/cielo/volumenes.wgsl`): 128³ para la forma (Perlin-Worley
  + tres octavas de Worley) y 32³ para el detalle. Worley 3D por píxel
  sería impagable; horneado, cada muestra de densidad son dos lecturas
  de textura.
- **Raymarch volumétrico a media resolución** (`nubes.wgsl`) con
  auto-sombreado por marcha hacia la luz, aproximación de dispersión
  múltiple de tres órdenes (lo que evita que el interior de la nube se
  vaya a negro) y fase de doble lóbulo.
- **La luna es una luz de primera clase**: la integración de dispersión
  del cielo se parametrizó por dirección de luz, así que el mismo código
  físico se evalúa para el sol y para la luna y se suma. La luna tiene
  dirección, intensidad por fase, color levemente frío y disco con
  terminador real y mares.
- **Exposición nocturna adaptada a la luz de luna**: una noche de luna
  llena no necesita abrir tanto el diafragma como una noche cerrada.

## Lo que todavía no está

- **Queda algo de trama en zonas de distancia media.** Es ruido de
  cuadratura de una sola muestra por píxel. Se redujo mucho acotando el
  error del punto de entrada a la nube, pero lo que lo elimina de verdad
  es el TAA, que entra en el hito 4.
- **El tiempo de GPU de este hito no está medido de forma confiable.**
  Durante toda la sesión la GPU estuvo entre 89 y 92 °C con el reloj
  frenado por temperatura en 300-360 MHz de 2100 (razón de freno 0x20),
  incluso en reposo y a 18 W. Las cifras tomadas en ese estado van de
  2,6 a 28 ms para escenas equivalentes, o sea que no miden el shader
  sino el freno. Lo mejor observado fue 3,6 ms a 1600x900. La medición
  buena hay que rehacerla dentro de Tauri con la GPU fría, como se hizo
  en el hito 1.
