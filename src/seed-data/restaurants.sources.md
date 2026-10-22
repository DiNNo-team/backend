# Fuentes de `restaurants.json` (Santiago, Sprint 2)

Datos de los 15 restaurantes reales que se agregan al seed. Formato en `AVISOS.md`, sección «Santiago». La validación de los criterios del reparto está en `restaurants.spec.ts`.

- **Reales:** nombre, dirección, categoría y horario. Salen de las fuentes de cada fila y están **por verificar** hasta que alguien los confirme en Google Maps o con el restaurante.
- **Datos de prueba:** mesas, capacidades, estados, `isOpen` y `ownerEmail`. No son reales.
- **Coordenadas:** están en `null` a propósito. Se copian a mano de Google Maps (clic derecho → copiar), con 6 decimales. Hasta entonces `restaurants.spec.ts` falla.
- **Correos:** `restaurante-01` a `restaurante-15@dinno.test`. Los correos reales del equipo se asignan después (aviso de Elizabeth).

## Hora de la demo

La prueba supone una demo **entre semana (lunes a viernes) de 9:00 a 11:00 a. m.**, hora de Bogotá (`DEMO_WINDOW` en `restaurants.spec.ts`). Si cambia, se cambia esa constante y la prueba dice qué restaurante deja de cumplir.

| Papel en la demo | Restaurantes |
|---|---|
| Aparece con **Disponible** | Abasto Quinta Camacho, Juan Valdez Café Emaús, McDonald's Calle 125, Cosechas Galerías, Myriam Camhi Andino |
| Aparece con **Pocas mesas** | Abasto Usaquén, Archie's Zona Rosa (exactamente 30 % libres: límite de la regla) |
| Aparece con **Sin mesas** | McDonald's Quinta Camacho (tiene además una mesa inactiva libre, que no cuenta), Cosechas Parque de los Hippies |
| **Fuera de horario** (`isOpen: true`, abre a mediodía) | Wok Quinta Camacho, Crepes & Waffles Zona G, Andrés D.C. |
| **Cerrado a mano** (`isOpen: false`) | Sipote Burrito Andino, Pesquera Jaramillo Parque de la 93 |
| **24 horas** | McDonald's Calle 125 |
| **Cierra al día siguiente** | Andrés D.C. (jueves a sábado hasta las 2:00 a. m.) |

La Plaza de Andrés El Retiro abre en la mañana salvo el jueves (según su fuente), así que no tiene un papel fijo.

## Restaurantes

| # | Restaurante | Zona | Categoría | Fuente de dirección y horario | Estado | Notas |
|---|---|---|---|---|---|---|
| 01 | Abasto Quinta Camacho | Quinta Camacho (Calle 72) | colombian | [abasto.com.co](https://abasto.com.co/) (sitio oficial) | Por verificar | — |
| 02 | Abasto Usaquén | Usaquén | colombian | [abasto.com.co](https://abasto.com.co/) (sitio oficial) | Por verificar | — |
| 03 | Juan Valdez Café Emaús | Zona G | cafe | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/juan-valdez-cafe-emaus) | Por verificar | Directorio, no fuente oficial |
| 04 | McDonald's Quinta Camacho | Quinta Camacho (Calle 72) | fast_food | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/mcdonalds-quinta-camacho) | Por verificar | **La fuente trae la dirección mal escrita** («a 71-99 Carrera 9 #711»): se dejó «Carrera 9 #71-99». Confírmala en Google Maps |
| 05 | McDonald's Calle 125 | Usaquén | fast_food | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/mcdonalds-calle-125) | Por verificar | 24 horas según la fuente |
| 06 | Cosechas Parque de los Hippies | Chapinero | healthy | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/cosechas-parque-de-los-hippies) | Por verificar | — |
| 07 | Cosechas Galerías | Galerías (Teusaquillo) | healthy | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/cosechas-carrera-30-calle-53-galerias) | Por verificar | — |
| 08 | Archie's Zona Rosa | Zona T | italian | [Tiendeo](https://www.tiendeo.com.co/Tiendas/bogota/archies-calle/7423), [Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d2461926-Reviews-Archie_s-Bogota.html) | Por verificar | Las fuentes no coinciden en la hora de cierre. Tiendeo dice viernes y sábado «08:00 - 12:00»; se tomó como medianoche, igual que Tripadvisor |
| 09 | Myriam Camhi Andino | Zona T | cafe | [Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d28488811-Reviews-Myriam_Camhi_Andino-Bogota.html) | Por verificar | Abre a las 9:00, justo al inicio de la franja de la demo |
| 10 | La Plaza de Andrés El Retiro | Zona T | colombian | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/la-plaza-de-andres-espartillal) | Por verificar | El jueves abre a las 12:00 según la fuente (los demás días a las 7:30). El sitio oficial no publica su horario |
| 11 | Crepes & Waffles Zona G | Calle 72 / Zona G | other | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/crepes-waffles-zona-g), [Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d1098891-Reviews-Crepes_Waffles-Bogota.html) | Por verificar | Tripadvisor cierra media hora antes entre semana. Categoría `other`: no encaja en ninguna de la lista |
| 12 | Wok Quinta Camacho | Quinta Camacho (Calle 72) | asian | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/wok-quinta-camacho) | Por verificar | — |
| 13 | Andrés D.C. | Zona T | grill | [andrescarnederes.com](https://www.andrescarnederes.com/en/como-llegar) (sitio oficial) | Por verificar | Otras fuentes ([Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d1889853-Reviews-or5025-Andres_Carne_de_Res_DC-Bogota.html), Waze) dan cierres distintos; se usó el oficial |
| 14 | Sipote Burrito Andino | Zona T | mexican | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/sipote-burrito-centro-andino) | Por verificar | — |
| 15 | Pesquera Jaramillo Parque de la 93 | Parque 93 | seafood | [pesquerajaramillo.com](https://pesquerajaramillo.com/) (sitio oficial) | Por verificar | — |

## Cómo se pasaron los horarios al formato

- Un día por elemento, de 1 (lunes) a 7 (domingo). Todos los restaurantes abren los 7 días según sus fuentes.
- Horas en `HH:MM` de 24 horas. «12:00 a. m.» (medianoche) se escribe `"00:00"`: el backend lo trata como cierre a medianoche, sin nada después.
- Un cierre después de medianoche (Andrés D.C., 2:00 a. m.) se escribe con `closesAt` menor que `opensAt`.
- 24 horas: `{ "dayOfWeek": n, "isOpen24h": true }`, sin horas.
