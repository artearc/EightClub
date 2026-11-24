// Runs the project's real firestore.rules (repo root) in the Firestore emulator and checks
// who can read/write what: PINs (pairPins), player sessions, pairContacts, revisiones, and
// the organizer's own write batches. See README.md in this folder for how to run it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, writeBatch, serverTimestamp, Timestamp } from "firebase/firestore";

const RULES = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "firestore.rules"), "utf8");
// the organizer is whoever isAdmin() names in the rules — read from there, not repeated here
const ADMIN = { email: (RULES.match(/request\.auth\.token\.email == '([^']+)'/) || [])[1], email_verified: true };
if (!ADMIN.email) throw new Error("No encuentro el email de isAdmin() en firestore.rules");
const env = await initializeTestEnvironment({
  projectId: "demo-eight",
  firestore: { rules: RULES, host: "127.0.0.1", port: 8085 },
});

const results = [];
async function t(name, expect, fn){
  try {
    await (expect === "ok" ? assertSucceeds(fn()) : assertFails(fn()));
    results.push(["PASS", expect.padEnd(4), name]);
  } catch (e){
    results.push(["FAIL", expect.padEnd(4), name + "  ← " + (e.message || e).toString().split("\n")[0]]);
  }
}
async function seed(){
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, "pairPins/p1"), { pin: "1111" });
    await setDoc(doc(db, "pairPins/p2"), { pin: "2222" });
    await setDoc(doc(db, "state/pairs"), { list: [{ id: "p1", j1: "Ana", j2: "Bea" }, { id: "p2", j1: "Carla", j2: "Dana" }, { id: "p3", j1: "Sin", j2: "Pin" }] });
    await setDoc(doc(db, "pairContacts/p2"), { contacto: "carla@ejemplo.com", actualizadoEn: Timestamp.now() });
  });
}
const anon = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();
const admin = () => env.authenticatedContext("admin-uid", ADMIN).firestore();
const nobody = () => env.unauthenticatedContext().firestore();
const login = (db, uid, pairId, pin) => setDoc(doc(db, "playerSessions", uid), { pairId, pin, creadoEn: serverTimestamp() });
function revisionBatch(db, uid, pairId){
  const b = writeBatch(db);
  b.set(doc(db, "revisiones", "rev-" + uid + "-" + pairId), { tipo: "liga", matchId: "m1", roundId: null, jornada: 1, pairId, pairLabel: "x", rivalLabel: "y",
    mySide: "a", sets: [{ a: 6, b: 3 }], estado: "pendiente", uid, creadoEn: serverTimestamp() });
  b.set(doc(db, "rateLimits", uid), { lastAt: serverTimestamp() });
  return b.commit();
}

await seed();
const u1 = anon("u1"), u2 = anon("u2"), u3 = anon("u3");

// --- PINs are unreadable to anyone but the organizer
await t("visitante sin login NO puede leer pairPins/p1", "fail", () => getDoc(doc(nobody(), "pairPins/p1")));
await t("usuario anónimo NO puede leer pairPins/p1", "fail", () => getDoc(doc(u1, "pairPins/p1")));
await t("organizador SÍ puede leer pairPins/p1", "ok", () => getDoc(doc(admin(), "pairPins/p1")));
await t("usuario anónimo NO puede escribir pairPins/p1", "fail", () => setDoc(doc(u1, "pairPins/p1"), { pin: "0000" }));
await t("state/pairs sigue siendo legible públicamente", "ok", () => getDoc(doc(nobody(), "state/pairs")));
await t("usuario anónimo NO puede escribir state/pairs", "fail", () => setDoc(doc(u1, "state/pairs"), { list: [] }));

// --- login = session doc, accepted only with the right PIN for that pair
await t("login p1 con PIN de otra pareja (2222) → rechazado", "fail", () => login(u1, "u1", "p1", "2222"));
await t("login p1 con PIN incorrecto (0000) → rechazado", "fail", () => login(u1, "u1", "p1", "0000"));
await t("login a pareja sin PIN (p3) → rechazado", "fail", () => login(u1, "u1", "p3", "1111"));
await t("login a pareja inexistente → rechazado", "fail", () => login(u1, "u1", "p9", "1111"));
await t("crear la sesión de OTRO uid → rechazado", "fail", () => login(u1, "u2", "p1", "1111"));
await t("sesión con campos extra → rechazado", "fail", () => setDoc(doc(u1, "playerSessions/u1"), { pairId: "p1", pin: "1111", admin: true }));
await t("sin login de Firebase → rechazado", "fail", () => login(nobody(), "u1", "p1", "1111"));
await t("login p1 con PIN correcto (1111) → aceptado", "ok", () => login(u1, "u1", "p1", "1111"));
await t("el dueño puede leer su propia sesión", "ok", () => getDoc(doc(u1, "playerSessions/u1")));
await t("otro usuario NO puede leer esa sesión (lleva el PIN tecleado)", "fail", () => getDoc(doc(u2, "playerSessions/u1")));
await t("otro usuario NO puede borrar esa sesión", "fail", () => deleteDoc(doc(u2, "playerSessions/u1")));

// --- pairContacts: authorized by the session, never by a PIN in the doc
await t("p1 cambia su nombre con sesión de p1 → aceptado", "ok", () => setDoc(doc(u1, "pairContacts/p1"), { j1: "Ana María", j2: "Bea", actualizadoEn: serverTimestamp() }, { merge: true }));
await t("pairContacts con campo pin → rechazado (doc público, no puede llevar PIN)", "fail", () => setDoc(doc(u1, "pairContacts/p1"), { j1: "Ana", pin: "1111" }, { merge: true }));
await t("sesión de p1 escribiendo pairContacts/p2 → rechazado", "fail", () => setDoc(doc(u1, "pairContacts/p2"), { j1: "Hacker" }, { merge: true }));
await t("usuario sin sesión escribiendo pairContacts/p1 → rechazado", "fail", () => setDoc(doc(u3, "pairContacts/p1"), { j1: "Hacker" }, { merge: true }));
await t("visitante sin login escribiendo pairContacts/p1 → rechazado", "fail", () => setDoc(doc(nobody(), "pairContacts/p1"), { j1: "Hacker" }, { merge: true }));
await t("nombre con «/» → rechazado", "fail", () => setDoc(doc(u1, "pairContacts/p1"), { j1: "Ana / X" }, { merge: true }));
await t("nombre vacío → rechazado", "fail", () => setDoc(doc(u1, "pairContacts/p1"), { j1: "" }, { merge: true }));
await t("email mal formado → rechazado", "fail", () => setDoc(doc(u1, "pairContacts/p1"), { contacto: "no-es-email" }, { merge: true }));
await t("campo extra (confirmed) → rechazado", "fail", () => setDoc(doc(u1, "pairContacts/p1"), { confirmed: false }, { merge: true }));
await t("p1 cambia su email → aceptado", "ok", () => setDoc(doc(u1, "pairContacts/p1"), { contacto: "ana@ejemplo.com", actualizadoEn: serverTimestamp() }, { merge: true }));
await t("jugador NO puede borrar pairContacts", "fail", () => deleteDoc(doc(u1, "pairContacts/p1")));
await t("pairContacts sigue siendo legible públicamente", "ok", () => getDoc(doc(nobody(), "pairContacts/p1")));
await t("login p2 (2222) → aceptado", "ok", () => login(u2, "u2", "p2", "2222"));
await t("p2 renombra (merge) sobre su doc antiguo con solo contacto → aceptado", "ok", () => setDoc(doc(u2, "pairContacts/p2"), { j2: "Daniela", actualizadoEn: serverTimestamp() }, { merge: true }));

// --- revisiones need the session of the pair they claim
await t("revisión de p1 con sesión de p1 (+ rateLimit en el mismo batch) → aceptado", "ok", () => revisionBatch(u1, "u1", "p1"));
await t("revisión haciéndose pasar por p2 con sesión de p1 → rechazado", "fail", () => revisionBatch(anon("u1"), "u1", "p2"));
await t("revisión sin sesión → rechazado", "fail", () => revisionBatch(u3, "u3", "p1"));
await t("jugador NO puede aceptar su propia revisión", "fail", () => updateDoc(doc(u1, "revisiones/rev-u1-p1"), { estado: "aceptada" }));

// --- a new PIN ends old sessions
await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), "pairPins/p1"), { pin: "5555" }));
await t("tras cambiar el PIN de p1, la sesión vieja ya NO puede editar", "fail", () => setDoc(doc(u1, "pairContacts/p1"), { j1: "Ana" }, { merge: true }));
await t("…ni enviar resultados", "fail", () => revisionBatch(anon("u1"), "u1", "p1"));
await t("re-login con el PIN viejo → rechazado", "fail", () => login(u1, "u1", "p1", "1111"));
await t("re-login con el PIN nuevo → aceptado", "ok", () => login(u1, "u1", "p1", "5555"));
await t("…y vuelve a poder editar", "ok", () => setDoc(doc(u1, "pairContacts/p1"), { j1: "Ana", actualizadoEn: serverTimestamp() }, { merge: true }));

// --- logout
await t("el dueño puede borrar su sesión (logout)", "ok", () => deleteDoc(doc(u1, "playerSessions/u1")));
await t("tras logout ya NO puede editar", "fail", () => setDoc(doc(u1, "pairContacts/p1"), { j1: "Ana" }, { merge: true }));

// --- organizer: the app's real batches
await t("organizador: nuevo PIN = state/pairs + pairPins en un batch → aceptado", "ok", () => {
  const db = admin(), b = writeBatch(db);
  b.set(doc(db, "state/pairs"), { list: [{ id: "p1", j1: "Ana", j2: "Bea" }, { id: "p2", j1: "Carla", j2: "Dana" }] });
  b.set(doc(db, "pairPins/p1"), { pin: "7777" });
  return b.commit();
});
await env.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), "inscripciones/ins1"), { j1: "N", j2: "J", contacto: "n@ejemplo.com", status: "pending" }));
await t("organizador: aceptar inscripción (pairs + pairPins + inscripción) → aceptado", "ok", () => {
  const db = admin(), b = writeBatch(db);
  b.set(doc(db, "state/pairs"), { list: [{ id: "p4", j1: "N", j2: "J" }] });
  b.set(doc(db, "pairPins/p4"), { pin: "4444" });
  b.update(doc(db, "inscripciones/ins1"), { status: "accepted" });
  return b.commit();
});
await t("jugador intentando ese mismo batch → rechazado entero", "fail", () => {
  const db = anon("u9"), b = writeBatch(db);
  b.set(doc(db, "state/pairs"), { list: [] });
  b.set(doc(db, "pairPins/p1"), { pin: "0000" });
  return b.commit();
});

// --- untouched rules still behave
await t("inscripción pública (crear) → aceptado", "ok", () => setDoc(doc(nobody(), "inscripciones/new1"), { j1: "a", j2: "b", contacto: "c@d.es", status: "pending" }));
await t("visitante NO puede leer inscripciones", "fail", () => getDoc(doc(nobody(), "inscripciones/new1")));
await t("voto de camiseta propio → aceptado", "ok", () => setDoc(doc(anon("v1"), "camisetaVotos/v1"), { estado: "pendiente", nombre: "Pepe", camisetaId: "c1" }));

await env.cleanup();
console.log(results.map(r => r.join("  ")).join("\n"));
const failed = results.filter(r => r[0] === "FAIL").length;
console.log("\n" + (results.length - failed) + "/" + results.length + " OK");
process.exit(failed ? 1 : 0);
