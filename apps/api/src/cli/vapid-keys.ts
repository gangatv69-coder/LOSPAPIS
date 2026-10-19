import { generateVapidKeys, vapidKeysToEnvLines } from '../push/vapid.ts';

// Entrada del bundle dist/vapid-keys.mjs. Imprime SOLO las dos líneas VAPID_* por stdout, para redirigirlas
// a un .env (en el servidor: `docker run --rm los-papis-api:<tag> node vapid-keys.mjs >> .env`; en el PC:
// `node apps/api/dist/vapid-keys.mjs >> .env`). Las claves nunca van al log ni a la pantalla.
process.stdout.write(vapidKeysToEnvLines(generateVapidKeys()));
