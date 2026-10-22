# Fuentes de `restaurants.json` (Santiago, Sprint 2)

Datos de los 15 restaurantes reales que se agregan al seed. Formato en `AVISOS.md`, sección «Santiago». La validación de los criterios del reparto está en `restaurants.spec.ts`.

- **Reales:** nombre, dirección, categoría y horario. Salen de las fuentes de cada fila y están **por verificar** hasta que alguien los confirme en Google Maps o con el restaurante.
- **Datos de prueba:** mesas, capacidades, estados, `isOpen` y `ownerEmail`. No son reales.
- **Coordenadas:** se copian a mano de Google Maps (clic derecho sobre el pin → copiar), con **máximo 6 decimales**. Mientras falte alguna, `restaurants.spec.ts` falla.
- **Correos:** `restaurante-01` a `restaurante-15@dinno.test`. Los correos reales del equipo se asignan después (aviso de Elizabeth).

## Hora de la demo

La prueba supone una demo **entre semana (lunes a viernes) de 9:00 a 11:00 a. m.**, hora de Bogotá (`DEMO_WINDOW` en `restaurants.spec.ts`). Si cambia, se cambia esa constante y la prueba dice qué restaurante deja de cumplir.

| Papel en la demo | Restaurantes |
|---|---|
| Aparece con **Disponible** | Abasto Quinta Camacho, Juan Valdez Café Emaús, Al Alma Parque 93, Kapira Restaurante Vegetariano, Myriam Camhi Andino |
| Aparece con **Pocas mesas** | Abasto Usaquén |
| Aparece con **Sin mesas** | McDonald's Parque 93 (tiene además una mesa inactiva libre, que no cuenta), Oakberry Zona T |
| **Fuera de horario** (`isOpen: true`, abre a mediodía) | Piazza Italia Calle 93, Crepes & Waffles Zona G, WOK Calle 69, Andrés D.C. |
| **Cerrado a mano** (`isOpen: false`) | Sipote Burrito Andino, Pesquera Jaramillo Parque de la 93 |
| **24 horas** | McDonald's Parque 93 (de martes a domingo) |
| **Cierra al día siguiente** | Andrés D.C. (jueves a sábado hasta las 2:00 a. m.) |
| **Límite del 30 %** (para el QA de Sergio) | Piazza Italia Calle 93: 3 de 10 mesas libres = Pocas mesas. Se ve después de las 12:00 |

La Plaza de Andrés El Retiro abre en la mañana salvo el jueves (según su fuente), así que no tiene un papel fijo.

## Restaurantes

| # | Restaurante | Zona | Categoría | Fuente de dirección y horario | Estado | Notas |
|---|---|---|---|---|---|---|
| 01 | Abasto Quinta Camacho | Quinta Camacho (Calle 72) | colombian | [abasto.com.co](https://abasto.com.co/) (sitio oficial) | Por verificar | — |
| 02 | Abasto Usaquén | Usaquén | colombian | [abasto.com.co](https://abasto.com.co/) (sitio oficial) | Por verificar | — |
| 03 | Juan Valdez Café Emaús | Zona G | cafe | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/juan-valdez-cafe-emaus) | Por verificar | Directorio, no fuente oficial |
| 04 | McDonald's Parque 93 | Parque 93 | fast_food | Horario: [mcdonalds.com.co](https://www.mcdonalds.com.co/restaurantes/bogota/bogota-parque-93-p93) (sitio oficial, solo dice «Carrera 12»). Dirección: [Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d15603375-Reviews-McDonald_s-Bogota.html), [enBogota](https://enbogota.com.co/sitios-restaurantes/mcdonalds-parque-de-la-93) | Por verificar | El sitio oficial dice lunes de 6:00 a 23:59 y de martes a domingo 24 horas. DiDi Food da otro horario (6:00 a 23:00) |
| 05 | Al Alma Parque 93 | Parque 93 | cafe | [Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d25788632-Reviews-Al_Alma_Parque_93-Bogota.html) | Por verificar | Café de comida colombiana |
| 06 | Oakberry Zona T | Zona T | healthy | [Atmosfy](https://atmosfy.io/location/barrio-san-luis/oakberry-a-a-zona-t) | Por verificar | Reemplaza a «Oakberry Açaí Zona G»: no se encontró un Oakberry en la Calle 70 #6-21. Fuente única, de un agregador |
| 07 | Kapira Restaurante Vegetariano | Teusaquillo (La Soledad) | healthy | Horario: [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/kapira-restaurante-vegetariano). Dirección: [Foursquare](https://lv.foursquare.com/angieq8339490/list/veggie) | Por verificar | Reemplaza a «Poke Zona G», que no se encontró. El directorio trae la dirección cortada («Calle 39a #21-1»); Foursquare dice Calle 39A #21-51. Cerrado el domingo |
| 08 | Piazza Italia Calle 93 | Parque 93 | italian | [restaurantestoriadamore.com](https://restaurantestoriadamore.com/pages/piazza-calle-93-bogota) (sitio oficial) | Por verificar | Reemplaza a «Trattoria La Divina Comedia»: existe, pero en la Calle 71 #5-83 y con dos turnos al día (12:00–15:30 y 18:45–22:30), que el formato del seed no admite. Tripadvisor da cierres algo distintos |
| 09 | Myriam Camhi Andino | Zona T | cafe | [Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d28488811-Reviews-Myriam_Camhi_Andino-Bogota.html) | Por verificar | Abre a las 9:00, justo al inicio de la franja de la demo |
| 10 | La Plaza de Andrés El Retiro | Zona T | colombian | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/la-plaza-de-andres-espartillal) | Por verificar | El jueves abre a las 12:00 según la fuente (los demás días a las 7:30). El sitio oficial no publica su horario |
| 11 | Crepes & Waffles Zona G | Calle 72 / Zona G | other | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/crepes-waffles-zona-g), [Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d1098891-Reviews-Crepes_Waffles-Bogota.html) | Por verificar | Tripadvisor cierra media hora antes entre semana. Categoría `other`: no encaja en ninguna de la lista |
| 12 | WOK Calle 69 | Quinta Camacho (Calle 72) | asian | Horario: [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/wok-quinta-camacho). Dirección: Google Maps (Santiago) | Por verificar | La dirección de Google Maps (Carrera 9 #69A-75) no coincide con la del directorio (#69A-63) |
| 13 | Andrés D.C. | Zona T | grill | [andrescarnederes.com](https://www.andrescarnederes.com/en/como-llegar) (sitio oficial) | Por verificar | Otras fuentes ([Tripadvisor](https://www.tripadvisor.com/Restaurant_Review-g294074-d1889853-Reviews-or5025-Andres_Carne_de_Res_DC-Bogota.html), Waze) dan cierres distintos; se usó el oficial. El enlace de Waze del sitio oficial lo ubica en 4.666337, -74.054179 |
| 14 | Sipote Burrito Andino | Zona T | mexican | [restaurantesenbogota.com](https://restaurantesenbogota.com/restaurante/sipote-burrito-centro-andino) | Por verificar | — |
| 15 | Pesquera Jaramillo Parque de la 93 | Parque 93 | seafood | [pesquerajaramillo.com](https://pesquerajaramillo.com/) (sitio oficial) | Por verificar | — |

## Cómo se pasaron los horarios al formato

- Un elemento por día abierto, de 1 (lunes) a 7 (domingo). Un día cerrado no se incluye (Kapira el domingo).
- Horas en `HH:MM` de 24 horas. «12:00 a. m.» (medianoche) se escribe `"00:00"`: el backend lo trata como cierre a medianoche, sin nada después.
- Un cierre después de medianoche (Andrés D.C., 2:00 a. m.) se escribe con `closesAt` menor que `opensAt`.
- 24 horas: `{ "dayOfWeek": n, "isOpen24h": true }`, sin horas.
- El formato admite un solo horario por día: un restaurante con dos turnos (almuerzo y cena) no se puede representar sin inventar el horario.
