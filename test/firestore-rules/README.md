# Test de las reglas de Firestore

`rules.test.mjs` carga el `firestore.rules` de la raíz del repo en el **emulador real de
Firestore** y comprueba, caso por caso, quién puede leer y escribir qué:

- `pairPins` (los PIN): solo el organizador puede leerlos o escribirlos.
- `playerSessions` (login de jugador): solo se crea con el PIN correcto **de esa pareja**;
  solo su dueño la lee o la borra.
- `pairContacts` (nombres y email editados por la pareja): solo desde una sesión válida de
  esa pareja, sin PIN dentro, con nombres/email bien formados.
- `revisiones`: solo desde una sesión de la pareja que dice enviarla.
- Un PIN nuevo invalida las sesiones antiguas de esa pareja; cerrar sesión también.
- Los batches reales del organizador (nuevo PIN, aceptar inscripción) siguen pasando.
- Lo que no se ha tocado (inscripciones, votos de camiseta) sigue funcionando igual.

No usa ningún proyecto real: el emulador corre en local con el proyecto ficticio
`demo-eight`, y no se sube ni se publica nada.

## Requisitos

- Node.js 18 o superior.
- Java 11–20 instalado (`java -version`). `firebase-tools` 14+ exige Java 21; por eso el
  `package.json` fija la versión 13. Si algún día instalas Java 21, se puede subir.

## Cómo lanzarlo

```powershell
cd test/firestore-rules
npm install
npm test
```

La primera vez, `npm install` descarga las dependencias (unos cientos de MB en
`node_modules/`, que no se suben al repo) y el primer `npm test` descarga además el
emulador de Firestore (un `.jar`, se guarda en `~/.cache/firebase/emulators`).

El resultado es una línea por caso (`PASS`/`FAIL`, qué se esperaba y la descripción) y un
total al final, p. ej. `48/48 OK`. El comando sale con código 1 si falla alguno. Las líneas
`PERMISSION_DENIED` / `evaluation error` que aparecen por encima son normales: son los casos
que **deben** ser rechazados.

Para liberar espacio después, borra la carpeta `node_modules/` de aquí.

## Si cambias las reglas

Añade aquí el caso nuevo (una línea `await t("descripción", "ok" | "fail", () => …)`) y
vuelve a lanzar `npm test` antes de publicar las reglas en la consola de Firebase.
