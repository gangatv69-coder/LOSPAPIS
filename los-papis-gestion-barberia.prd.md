# PRD — LOS PAPIS: caja, inventario y citas por WhatsApp

**Fecha:** 18 de octubre de 2026 · **Dueño del producto:** dueño de LOS PAPIS · **Estado:** aprobado en entrevista, listo para arquitectura
**Sistema listo para pruebas:** finales de enero de 2027 · **Apertura de la barbería:** marzo–abril de 2027 · **Arquitectura:** [los-papis-gestion-barberia.architecture.md](los-papis-gestion-barberia.architecture.md)

> **En una línea:** que en LOS PAPIS ningún euro, corte ni producto pase sin quedar registrado a nombre de alguien, y que los clientes aprendan a reservar solos por WhatsApp (en italiano o español) en vez de hacer fila.

Este documento recoge la **intención**: qué se construye y por qué. No decide tecnología, base de datos, seguridad ni hosting. Eso le toca a `plan-architecture` (ver [Para la arquitectura](#para-la-arquitectura)).

---

## 1. Problema

El dueño de una barbería nueva en Italia (2 barberos con sueldo fijo, y él o su esposa siempre en la caja) **no tiene cómo saber, el mismo día, si cada euro, cada corte y cada producto quedó registrado y a nombre de quién**. En otras barberías ha visto que el dinero se pierde sin dejar rastro, y nadie lo nota hasta fin de mes, o nunca.

Las fugas que más le preocupan:

- **(a)** cobros en efectivo que no se registran;
- **(c)** descuentos o cortes gratis inventados;
- **(f)** productos que se venden sin registrar o que desaparecen.

Dos cosas lo agravan:

- **Sueldo fijo.** El barbero no gana más por registrar cada corte, así que no tiene interés propio en que todo quede anotado.
- **Días llenos.** Un sábado de 40–50 clientes con 2 barberos deja unos 25 minutos por cliente, así que habrá fila. Con prisa se cobra rápido y se registra "después", que es justo cuando se pierden las cuentas. Y algún cliente que espera se va.

**Lo que cuesta no resolverlo:** dinero perdido sin detectar, cierres de caja que no cuadran y nadie sabe por qué, productos agotados sin aviso, clientes que se van por la fila, y riesgo fiscal si lo cobrado no coincide con lo declarado.

Con el dueño o su esposa siempre en la caja, barberos que no tocan dinero y cámaras en el local, el robo en caja ya es poco probable. Los riesgos que quedan son tres:

- **errores honestos**: vuelto mal dado, un pago con tarjeta marcado como efectivo;
- **servicios que nunca pasan por la caja**;
- **productos e insumos que desaparecen**.

Registrarlo todo también deja preparado el día en que entre alguien de fuera a la caja o se le venda el sistema a otras barberías.

## 2. Evidencia

La barbería todavía no ha abierto, así que **no hay datos propios**. Casi todo lo que sigue es una suposición que se comprueba en los simulacros y en los primeros 2–3 meses.

| Afirmación | Tipo | Cómo se valida |
|---|---|---|
| En barberías se pierde dinero por cobros no registrados, descuentos falsos y productos | Observación del dueño en otras barberías, sin cifras | Cierres diarios y conteos semanales de los primeros 2 meses |
| Un sábado lleno son 40–50 clientes | Estimación del dueño | Cobros reales del primer mes |
| La mayoría llegará sin cita | Estimación del dueño | % de cobros con cita frente a sin cita, por mes |
| Los clientes aceptarán reservar por WhatsApp | **Suposición** | % de clientes con cita en los meses 1, 2 y 3 |
| Cobrar en el sistema puede ser tan rápido que no frene la fila | **Suposición** | Cronometrarlo en el simulacro de sábado |
| Los barberos avisarán cuando se acabe un insumo | **Suposición** | Avisos frente a insumos agotados, por semana |
| Los clientes darán su teléfono y valorarán el servicio | **Suposición** | Tasa de respuesta a la valoración (meta TBD) |

## 3. Tesis: por qué construirlo

- **Por qué esto.** El dueño quiere control total desde el primer día: saber quién cobró qué, cuándo y cómo, sin tener que confiar a ciegas.
- **Por qué ahora.** La apertura es el único momento en que todos empiezan con el hábito de registrarlo todo; cambiar costumbres después cuesta mucho más. Quedan unos 5 meses para construir y probar.
- **Por qué es mejor que las alternativas.**
  - Frente al **cuaderno o el Excel**: no dicen quién hizo cada cosa, se pueden corregir sin dejar rastro y no cuadran solos.
  - Frente a **Fresha, Treatwell o Booksy**: el sistema y los datos son del dueño. No hay **suscripción ni comisiones**, las reglas están hechas para esta barbería (nada se borra, solo un manager da descuentos) y el bot habla italiano y español. Más adelante el dueño podría vendérselo a otras barberías.
- **Riesgos de esta apuesta.**
  - **Sin suscripción no quiere decir gratis.** Hay que pagar el servidor, el dominio y algunos mensajes de WhatsApp.
  - **No hay soporte externo.** El mantenimiento lo hacen el dueño y Claude; si algo falla un sábado, no hay a quién llamar.

## 4. Hipótesis

**H1. Caja (la principal)**

> **Creemos que** si cada corte y cada producto se cobra en la caja y queda registrado con barbero, servicio, manager y forma de pago, y cada noche un cierre compara el sistema con el efectivo del cajón y con el POS,
> **los dos managers** verán cualquier diferencia el mismo día,
> **y como resultado** LOS PAPIS cerrará cada mes sin dinero perdido sin explicación.
>
> **Acertamos si**, en los primeros 2 meses abiertos, al menos el **95% de los cierres diarios** cuadran con una diferencia **de €2 o menos**, o la diferencia tiene una explicación escrita.
> **Fallamos si** en horas pico se deja de registrar en el momento ("lo apunto y luego lo meto"), o si un sábado de 40–50 clientes cobrar tarda **más de ~30 segundos** y se forma cola en la caja.

**H2. Inventario**

> **Creemos que** registrar cada venta de producto desde la caja (con foto, precio y stock), y que los barberos avisen cuando se acaba un insumo,
> **hará que** nada llegue a cero sin que el manager lo sepa,
> **y como resultado** cualquier producto que desaparezca se notará esa misma semana.
>
> **Acertamos si** el conteo físico semanal coincide con el sistema (diferencia cero o explicada) y ningún insumo se agota sin aviso previo.
> **Fallamos si** el manager se entera de que algo se acabó cuando ya no queda, o si el conteo no cuadra **2 semanas seguidas**.

**H3. Citas por WhatsApp**

> **Creemos que** un bot en italiano y español para reservar, mover y cancelar citas, eligiendo barbero y servicio,
> **hará que** los clientes se acostumbren a sacar cita en vez de llegar y esperar,
> **y como resultado** habrá menos fila en la barbería.
>
> **Acertamos si** el % de clientes que llegan con cita **sube cada mes** hasta llegar **al 30% o más en el tercer mes**, y si **el 70% o más** de las citas se crean o cambian sin ayuda de una persona.
> **Fallamos si** a los 3 meses el % con cita no ha subido, si **más de 1 de cada 3** conversaciones termina en "quiero hablar con una persona", o si ocurre **una sola doble reserva**.

## 5. Usuarios y trabajos por hacer (JTBD)

**Usuario principal: el manager.** Hay dos cuentas: Manager 1, el dueño, y Manager 2, su esposa. Siempre hay uno de los dos en la caja.

> *Cuando cierro el día, o cuando no estuve, quiero saber exactamente cuánto entró, quién lo cobró, cuánto fue en efectivo y cuánto con tarjeta, y qué productos salieron, para detectar cualquier faltante ese mismo día y no a fin de mes.*

**Barbero.** Dos al abrir, con sueldo fijo de €1.400 al mes y sin comisión por productos. Nunca toca dinero.

> *Cuando empiezo el día, quiero ver mis citas, mis clientes y cuánto he facturado, y poder cancelar o mover una cita, para organizarme sin depender del dueño.*

**Cliente.** Habla italiano o español, y la mayoría llega sin cita.

> *Cuando quiero cortarme, quiero reservar con mi barbero por WhatsApp en mi idioma, sin llamar, para no esperar en la barbería.*

### Qué puede hacer cada rol

| Acción | Manager | Barbero |
|---|---|---|
| Cobrar servicios y productos | Sí | No (nunca toca dinero) |
| Dar descuentos y autorizar cortes gratis, con motivo | Sí | No |
| Anular un cobro con motivo (borrar, nunca) | Sí | No |
| Hacer el cierre de caja y registrar salidas de dinero | Sí | No |
| Gestionar inventario y precios | Sí | No |
| Avisar que se acabó un insumo | Sí | Sí |
| Ver las citas del día y el nombre de los clientes | Sí, de todos | Solo las suyas |
| Cancelar o mover citas | Sí, todas | Solo las suyas |
| Ver cuánto se ha facturado | Sí, de todos | Solo lo suyo |
| Ver estadísticas, valoraciones, gastos y ganancia | Sí | No |

### Para quién NO es, por ahora

- **Cajero o cajera:** ese rol no existe hoy.
- **Otras barberías o un segundo local.**
- **El commercialista:** recibe reportes, pero no usa el sistema (TBD).
- **El cliente:** no tiene cuenta ni panel. Su único canal es WhatsApp.

### Restricciones

- **Italia, lo fiscal.** Cada cobro tiene que cumplir con el recibo fiscal (documento commerciale y corrispettivi telematici), y quizá con la vinculación entre el POS y el registratore. Cómo encaja eso con la caja está **TBD: hay que preguntarlo al commercialista** ([lista de preguntas](https://claude.ai/code/artifact/f2c992b8-259b-487e-9e52-4abd67571713)).
- **Italia, lo laboral.** Las cámaras y el registro de lo que hace cada barbero pueden caer en el art. 4 del Statuto dei Lavoratori. **TBD: hay que preguntarlo al consulente del lavoro.**
- **Privacidad (GDPR).** Se guardan nombres, teléfonos, citas y valoraciones de clientes, así que hace falta su permiso desde el primer contacto.
- **Idiomas.** El bot habla italiano y español. El idioma del panel está por decidir.
- **Pagos.** Efectivo y tarjeta.
- **Fechas.** Listo para pruebas a finales de enero de 2027; la barbería abre en marzo o abril de 2027.
- **Costo.** Sin suscripciones. El sistema y los datos son del dueño.
- **Equipo.** Lo construyen el dueño y Claude.
- **Puesta en marcha.** Primero en local; después en un VPS con dominio propio.

## 6. MVP

**La línea más fina que prueba las hipótesis de punta a punta** es cobrar, registrar, cerrar el día y que cuadre. Si eso falla en el simulacro, lo demás no importa. Se construye en 4 etapas, **en este orden**, y cada una se prueba antes de pasar a la siguiente.

| Etapa | Qué incluye | Qué prueba |
|---|---|---|
| **1. Cobro y cierre de caja** | Entrar con usuario según el rol · cobrar un servicio o producto asignado a un barbero, en efectivo o con tarjeta · descuentos solo por fidelidad o dados por un manager, con motivo · cortes gratis solo con autorización de un manager · anular con motivo, **nunca borrar** · registrar el dinero que sale del cajón · cierre diario que compara sistema, cajón y POS, con margen de €2 · teléfono del cliente en cada cobro, con su permiso | H1 |
| **2. Inventario** | Productos con foto, precio y stock · cada venta descuenta del stock · conteo semanal · aviso del barbero cuando se acaba un insumo | H2 |
| **3. Bot de WhatsApp** | Italiano y español · reservar, mover y cancelar · elegir barbero y servicio · sin dobles reservas · recordatorio de la cita · opción de hablar con una persona | H3 |
| **4. Valoraciones y panel** | Valoración por WhatsApp que el cliente inicia escaneando un QR en la caja (sin costo de mensajes), con su permiso · panel del manager con ingresos, gastos del mes, ganancia real, cortes por barbero y valoraciones (privado) · vista del barbero | Datos para los bonos y para el futuro ranking |

### Reglas fijas (también para los dos managers)

- Nada se borra. Un error se **anula con un motivo** y la anulación queda a la vista.
- Cada movimiento queda con persona, fecha y hora.
- Los barberos nunca cobran ni tocan dinero.
- Los descuentos son solo por fidelidad o los da un manager, con motivo. Los cortes gratis necesitan la autorización de un manager.
- Los cortes y las valoraciones se guardan desde el primer día, aunque el ranking público siga apagado.

### Pruebas antes de abrir (febrero–marzo de 2027)

La barbería no abre hasta pasar estas tres pruebas.

- **Simulacro de sábado** con amigos y familia: 50 cobros en un día y cierre al final. Se aprueba si el cierre cuadra (diferencia de €2 o menos) y no se forma cola en la caja.
- **Prueba del bot:** entre 10 y 20 personas, en italiano y español, intentan reservar, mover, cancelar y "romper" el bot. Se aprueba si no hay dobles reservas y la mayoría termina sin ayuda.
- **Conteo de inventario** después del simulacro: tiene que coincidir con el sistema.

### Qué se puede cambiar después y qué no

| Decisión | Tipo | Por qué | Cuándo decidirla |
|---|---|---|---|
| Cómo se conecta la caja con el recibo fiscal | Difícil de cambiar: investigar antes | Puede cambiar todo el proceso de cobro | Después del commercialista, antes de la etapa 1 |
| Número de WhatsApp del bot y vía (oficial o no) | Difícil de cambiar: investigar antes | Si bloquean el número, se pierde el que ya conocen los clientes | Antes de imprimirlo en tarjetas o redes |
| Un solo local o varias barberías | Difícil de cambiar | Adaptarlo después cuesta muy caro | En la arquitectura, aunque hoy sea un solo local |
| Historial donde nada se borra | Difícil de cambiar | Si se puede editar, el historial deja de ser confiable | Etapa 1 |
| Permiso de privacidad desde el primer mensaje | Difícil de cambiar | No se puede pedir con efecto retroactivo | Etapa 3 |
| Pantallas, colores, textos del bot, servicios y precios, reglas del ranking | Fácil de cambiar | Se ajustan cuando se quiera | Construir y ajustar |

**Después del MVP (ya decidido):** el ranking público y el "barbero del mes". Se activan cuando haya más barberos, y para entonces los datos ya estarán guardados.

## 7. Métricas de éxito

| Métrica | Meta | Cómo se mide | Hipótesis |
|---|---|---|---|
| Cierres diarios que cuadran (diferencia de €2 o menos, o explicada) | 95% o más en los primeros 2 meses | Historial de cierres | H1 |
| Tiempo para cobrar en un sábado lleno | ~30 s o menos por cobro, sin cola en la caja | Cronómetro en el simulacro y en los primeros sábados | H1 (alerta) |
| Cobros que se registran después y no en el momento | 0 | Observación de los managers | H1 (alerta) |
| Diferencia entre conteo físico semanal y sistema | Cero o explicada | Conteo semanal | H2 |
| Insumos que se agotan sin aviso previo | 0 | Avisos frente a insumos agotados | H2 |
| % de clientes que llegan con cita | Sube cada mes; 30% o más en el mes 3 | Cobros con cita / total de cobros | H3 |
| Citas creadas o cambiadas sin ayuda de una persona | 70% o más | Registro del bot | H3 |
| Conversaciones que piden hablar con una persona | Menos de 1 de cada 3 | Registro del bot | H3 (alerta) |
| Dobles reservas | 0 | Agenda | H3 (alerta) |
| Clientes que responden a la valoración | TBD, hay que validarla | Valoraciones / cobros con teléfono | Futuro ranking |
| Pruebas antes de abrir superadas | 3 de 3 | Resultado de cada prueba | Requisito para abrir |

## 8. Lo que NO vamos a hacer

- Ranking público y "barbero del mes" visible para los clientes (va después del MVP).
- Rol de cajero o cajera.
- Varios locales, o vender el sistema a otras barberías. Aun así, la arquitectura tiene que tenerlo en cuenta.
- Promociones o marketing por WhatsApp, tarjetas regalo o paquetes prepagados.
- Cobrar citas por adelantado o aceptar pagos online.
- Calcular nóminas (buste paga). Los sueldos solo se registran como gasto.
- Reemplazar al commercialista o la contabilidad oficial.
- Cuenta, app o panel para clientes. Su canal es WhatsApp.

## 9. Preguntas abiertas

**Legales y fiscales (hay que resolverlas antes de la etapa 1)**

- [ ] ¿Cómo se emite el recibo fiscal y cómo encaja con la caja: registratore telematico, RT en la nube o procedimiento web? → commercialista
- [ ] ¿Es obligatorio vincular el POS con el registratore? ¿Afecta al sistema? → commercialista
- [ ] ¿Qué régimen fiscal y qué tipos de IVA aplican a servicios y a productos? → commercialista
- [ ] ¿Las cámaras y el registro de lo que hace cada barbero necesitan un acuerdo o una autorización (art. 4)? → consulente del lavoro
- [ ] ¿Qué informativa y qué permiso GDPR hacen falta para los recordatorios y las valoraciones por WhatsApp? → commercialista o consultor de privacidad

**Negocio**

- [ ] ¿Los €1.400 son netos o brutos? ¿Cuánto cuesta en total cada barbero? (hace falta para calcular la ganancia real)
- [ ] Con sueldo fijo, ¿qué significa "ganancias" en la vista del barbero: lo que ha facturado, su bono, o las dos cosas?
- [ ] Regla de fidelidad: ¿cada cuántas visitas, qué descuento, y se aplica sola o la aplica el manager?
- [ ] Bono mensual privado: ¿qué pesa más, los cortes o las valoraciones? ¿De cuánto es?
- [ ] Propinas: ¿se aceptan con tarjeta? ¿De quién son y cómo se registran?
- [ ] Lista de servicios con precio y duración, horario de la barbería y horario de cada barbero.
- [ ] Si un cliente no quiere dar su teléfono, ¿se registra el cobro sin él?
- [ ] Si un cliente no se presenta a su cita, ¿pasa algo?
- [ ] ¿Cuánto es aceptable pagar al mes para que funcione (servidor, dominio, mensajes de WhatsApp)?

**Producto y operación**

- [ ] Si el sistema falla con la barbería abierta, ¿cuál es el plan B para seguir cobrando sin perder registros?
- [ ] ¿En qué idioma está el panel: español, italiano o los dos?
- [ ] ¿Qué tasa mínima de respuesta a las valoraciones hace falta para confiar en el ranking?
- [ ] Cuando se active, ¿dónde verán los clientes al "barbero del mes": pantalla en el local, web o WhatsApp?
- [ ] ¿Cuándo y qué tan en serio va lo de tener varios locales o vender el sistema? (de eso depende cuánto lo prepara la arquitectura)

## Para la arquitectura

Este PRD **no decide** cómo se construye. Eso lo decide `plan-architecture`, y las decisiones ya están en [el documento de arquitectura](los-papis-gestion-barberia.architecture.md):

- tecnologías, lenguajes y versiones;
- modelo de datos, y cómo se garantiza que nada se borre;
- seguridad: contraseñas, sesiones, permisos por rol y protección de los datos de clientes;
- conexión con WhatsApp y con el sistema fiscal;
- copias de seguridad y recuperación (la intención es **no perder nunca un registro**);
- qué pasa si se cae internet o el sistema;
- paso de local al VPS con dominio;
- estrategia de pruebas.
