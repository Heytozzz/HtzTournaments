# HtzTournaments

Crea cuadros de torneo y tablas de clasificación directamente en el navegador. No hay que instalar nada, no se necesita cuenta y no hay servidor: todo se guarda en el navegador de quien lo usa (localStorage).

## Qué hace

- **Participantes**: añadir uno por uno, pegar una lista (un nombre por línea) o importar `.txt`, `.csv` o `.json`. Para editar un nombre, haz clic en él. También puedes reordenar, ordenar de la A a la Z y **barajear**.
- **Suplentes**: marca a cualquiera como suplente (al añadirlo, con `(suplente)` al final de la línea o con la etiqueta Titular/Suplente). Con el torneo ya en marcha, un suplente puede **entrar por** cualquier jugador que siga en juego. Toma su lugar en el cuadro, se queda con su siembra y queda registrado en "Cambios".
- **Cuadro** (eliminación directa): el cuadro se arma a la siguiente potencia de 2 y los pases directos se reparten solos. Opciones:
  - partido por el 3er lugar;
  - llenar los pases directos con suplentes;
  - usar el orden de la lista como siembra (1 vs último).
- **Eliminación** (último en pie): una lista donde tocas a quien queda fuera hasta que quede uno. El último en salir es el 2º, el anterior el 3º, y así. También puedes eliminar a alguien al azar.
- **Por equipos**: equipos de 2 a 10 personas. Puedes poner a alguien en un equipo a mano y sortear al resto. Funciona con los tres formatos.
- **Sorteo animado** al empezar, al armar equipos y al eliminar al azar: ruleta o choque de nombres con un VS en el centro. La velocidad y los tiempos se cambian en Ajustes.
- **Ajustes**: color del tema (8 colores), diseño del cuadro (Espejo, Clásico, Ronda a ronda o Automático), animaciones y sonido (el de HtzRoulette o Minecraft).
- **Liga** (todos contra todos): calendario por jornadas, con descansos si el número es impar. Tiene ida y vuelta opcional, puntos configurables (3/1, 2/1, 1/0) y una tabla con PJ, G, E, P, puntos a favor y en contra, y diferencia.
- **Resultados**: haz clic en un nombre para darle la victoria (otro clic la quita) o escribe el marcador. Si cambias un resultado anterior, el cuadro se corrige solo.
- **Clasificación**: podio con los lugares que elijas premiar (solo campeón, 1º–2º, 1º–3º, hasta 4º u 8º) y la tabla completa, con puestos compartidos (por ejemplo, 5º–8º).
- **Varios torneos** en el mismo navegador, con selector en la barra superior.
- **Deshacer** (botón o Ctrl+Z), **modo presentación** a pantalla completa para el stream e **impresión** del cuadro en blanco.
- **Importar y exportar**: la lista en `.txt` o `.csv`, el torneo completo en `.json`, o un **código para compartir** (comprimido) que abre el mismo torneo en otro navegador.

## Publicar en GitHub Pages

1. Sube esta carpeta a la rama `main` de https://github.com/Heytozzz/HtzTournaments.
2. En GitHub, ve a `Settings` → `Pages` → "Build and deployment" → "Source" y elige **GitHub Actions** (solo se hace una vez).
3. Cada push a `main` que toque `web/` se publica solo en https://heytozzz.github.io/HtzTournaments/.

## Probar localmente

Abre `web/index.html` en el navegador, o sirve la carpeta:

```
npx http-server web -p 5174
```
