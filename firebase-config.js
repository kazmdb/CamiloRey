// Configuración de Firebase
// Credenciales del proyecto peluqueriamartin-beefb
const firebaseConfig = {
    apiKey: "AIzaSyDuuqx99GlvurjAem7RxuRucyGLkM6fIG4",
    authDomain: "peluqueriamartin-beefb.firebaseapp.com",
    projectId: "peluqueriamartin-beefb",
    storageBucket: "peluqueriamartin-beefb.firebasestorage.app",
    messagingSenderId: "992167746012",
    appId: "1:992167746012:web:fdcabb47a07421dc955719",
    measurementId: "G-41676SSJVH"
};

// Inicializar Firebase
try {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase inicializado correctamente');
} catch (error) {
    console.error('Error al inicializar Firebase:', error);
}

// Inicializar Firestore
let db;
try {
    db = firebase.firestore();
    console.log('Firestore inicializado correctamente');
} catch (error) {
    console.error('Error al inicializar Firestore:', error);
}

// Función para guardar reserva en Firebase con transacción atómica
async function guardarReservaFirebase(reserva) {
    try {
        console.log('=== GUARDANDO RESERVA EN FIREBASE CON TRANSACCIÓN ===');
        console.log('Datos de reserva:', reserva);

        if (!db) {
            throw new Error('Firestore no está inicializado');
        }

        const dateKey = reserva.date || reserva.fecha;
        const startSlot = reserva.timeSlot != null ? reserva.timeSlot : 0;
        const cantidad = reserva.totalTurnos || 1;

        // Obtener configuración de reservas por turno
        let reservasPorTurnoActual = 1;
        try {
            reservasPorTurnoActual = await obtenerConfigReservasPorTurno();
            console.log('Configuración de reservas por turno:', reservasPorTurnoActual);
        } catch (error) {
            console.log('Error al obtener configuración, usando valor por defecto 1:', error);
        }

        // Ejecutar verificación de disponibilidad leyendo /reservas directamente
        console.log('🔄 Verificando disponibilidad leyendo reservas activas...');

        // Consultar directamente la colección /reservas contando las reservas activas en ese slot
        const reservasSnap = await db.collection('reservas')
            .where('date', '==', dateKey)
            .where('estado', 'not-in', ['cancelado', 'cancelada'])
            .get();

        console.log(`📊 Total de reservas activas para ${dateKey}:`, reservasSnap.size);

        // Contar ocupación real por slot
        const ocupacion = {};
        reservasSnap.forEach(doc => {
            const r = doc.data();
            const rSlot = r.timeSlot != null ? r.timeSlot : 0;
            for (let i = 0; i < (r.totalTurnos || 1); i++) {
                const sid = rSlot + i;
                ocupacion[sid] = (ocupacion[sid] || 0) + 1;
            }
        });

        console.log('📊 Ocupación por slot:', ocupacion);

        // Verificar cada slot que se quiere reservar
        for (let i = 0; i < cantidad; i++) {
            const slotId = startSlot + i;
            const ocupacionSlot = ocupacion[slotId] || 0;
            console.log(`Verificando slot ${slotId}: ocupación=${ocupacionSlot}, máximo=${reservasPorTurnoActual}`);

            if (ocupacionSlot >= reservasPorTurnoActual) {
                throw new Error('El horario seleccionado ya no está disponible. Por favor elegí otro.');
            }
        }

        console.log('✅ Disponibilidad verificada, guardando reserva...');

        // Guardar directamente (sin leer ni escribir turnosData)
        const reservaRef = db.collection('reservas').doc();
        await reservaRef.set({
            ...reserva,
            whatsappEnviado: false,
            whatsappActivo: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        console.log('✅ Reserva guardada con ID:', reservaRef.id);

        // Enviar WhatsApp si hay teléfono (fuera de la transacción)
        const telefono = reserva.telefono || reserva.phone;

        if (telefono) {
            try {
                console.log('📱 Intentando enviar WhatsApp para reserva:', reservaRef.id);
                console.log('📱 Teléfono:', telefono);

                const resultado = await enviarConfirmacionWhatsApp(reserva);
                console.log('📱 Resultado del envío de WhatsApp:', resultado);

                if (resultado.success) {
                    await db.collection('reservas').doc(reservaRef.id).update({
                        whatsappEnviado: true,
                        whatsappEnviadoEn: firebase.firestore.FieldValue.serverTimestamp()
                    });
                    console.log('✅ WhatsApp enviado exitosamente para reserva:', reservaRef.id);
                } else {
                    console.error('❌ Error al enviar WhatsApp:', resultado.error);
                    // No fallar la reserva si falla el WhatsApp
                }
            } catch (error) {
                console.error('❌❌ Error al enviar WhatsApp:', error);
                console.error('Error message:', error?.message || 'Error desconocido');
                console.error('Error stack:', error?.stack || 'No stack disponible');
                // No fallar la reserva si falla el WhatsApp
            }
        } else {
            console.log('⚠️ No hay teléfono para enviar WhatsApp');
            console.log('Campos disponibles:', Object.keys(reserva));
        }

        return reservaRef.id;
    } catch (error) {
        console.error('❌❌ Error al guardar reserva:', error);
        console.error('Error message:', error?.message || 'Error desconocido');
        console.error('Error stack:', error?.stack || 'No stack disponible');

        // Si el error es de disponibilidad, lanzar un mensaje específico
        if (error.message && error.message.includes('ya no está disponible')) {
            throw error;
        }

        throw error;
    }
}

// Función para obtener todas las reservas
async function obtenerReservasFirebase() {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        // Forzar a obtener datos del servidor, no de caché
        const snapshot = await db.collection('reservas')
            .orderBy('createdAt', 'desc')
            .get({ source: 'server' });

        const reservas = [];
        snapshot.forEach(doc => {
            reservas.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return reservas;
    } catch (error) {
        console.error('Error al obtener reservas:', error);
        throw error;
    }
}

// Función para actualizar reserva
async function actualizarReservaFirebase(id, datos) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        await db.collection('reservas').doc(id).update(datos);
        console.log('Reserva actualizada:', id);
    } catch (error) {
        console.error('Error al actualizar reserva:', error);
        throw error;
    }
}

// Función para eliminar reserva
async function eliminarReservaFirebase(id) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        await db.collection('reservas').doc(id).delete();
        console.log('Reserva eliminada:', id);
    } catch (error) {
        console.error('Error al eliminar reserva:', error);
        throw error;
    }
}

// Función para guardar turnosData en Firebase
async function guardarTurnosDataFirebase(turnosData) {
    try {
        console.log('💾 guardarTurnosDataFirebase - Iniciando...');
        console.log('💾 db está disponible:', !!db);

        if (!db) {
            throw new Error('Firestore no está inicializado');
        }

        console.log('💾 Guardando turnosData en Firebase...');
        console.log('Datos a guardar:', JSON.stringify(turnosData, null, 2));

        const result = await db.collection('config').doc('turnosData').set({
            data: turnosData,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        console.log('✅ TurnosData guardado en Firebase correctamente');
        console.log('✅ Resultado de la operación:', result);
    } catch (error) {
        console.error('❌ Error al guardar turnosData:', error);
        console.error('❌ Error stack:', error.stack);
        throw error;
    }
}

// Función para obtener turnosData de Firebase (SIN CACHÉ - siempre actualizado)
async function obtenerTurnosDataFirebase() {
    try {
        if (!db) {
            console.error('❌ Firestore no está inicializado, usando valor por defecto');
            return {};
        }

        console.log('📥 Obteniendo turnosData de Firebase (forzando servidor)...');

        // Forzar a obtener datos del servidor, no de caché
        const doc = await db.collection('config').doc('turnosData').get({ source: 'server' });

        console.log('Doc exists:', doc.exists);
        console.log('Doc metadata:', doc.metadata);

        if (doc.exists) {
            const data = doc.data();
            console.log('Datos crudos:', JSON.stringify(data, null, 2));

            const result = data.data || {};
            console.log('turnosData extraído:', JSON.stringify(result, null, 2));

            return result;
        } else {
            console.log('⚠️ Documento turnosData no existe, usando objeto vacío');
            return {};
        }
    } catch (error) {
        console.error('❌ Error al obtener turnosData:', error);
        return {};
    }
}

// Función para escuchar cambios en tiempo real en las reservas
function escucharReservasFirebase(callback) {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, no se pueden escuchar reservas');
            return () => {}; // Retornar función de limpieza vacía
        }
        return db.collection('reservas')
            .orderBy('createdAt', 'desc')
            .onSnapshot((snapshot) => {
                const reservas = [];
                snapshot.forEach(doc => {
                    reservas.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                callback(reservas);
            }, (error) => {
                console.error('Error al escuchar reservas:', error);
            });
    } catch (error) {
        console.error('Error al configurar escucha de reservas:', error);
        return () => {}; // Retornar función de limpieza vacía
    }
}

// Función para escuchar cambios en tiempo real en turnosData
function escucharTurnosDataFirebase(callback) {
    try {
        console.log('🔧 escucharTurnosDataFirebase - Iniciando configuración...');
        console.log('🔧 db está disponible:', !!db);
        console.log('🔧 db object:', db);

        if (!db) {
            console.error('❌ Firestore no está inicializado, no se pueden escuchar turnosData');
            return () => {}; // Retornar función de limpieza vacía
        }

        console.log('🔧 Configurando listener para turnosData...');
        console.log('🔧 Colección: config, Documento: turnosData');

        return db.collection('config').doc('turnosData')
            .onSnapshot(
                { includeMetadataChanges: false }, // ← CLAVE: solo disparar con datos del servidor
                (doc) => {
                    if (doc.metadata.fromCache) return; // ← ignorar datos de caché local

                    console.log('📡 Snapshot recibido de turnosData (servidor)');
                    console.log('Doc exists:', doc.exists);
                    console.log('Doc metadata:', doc.metadata);

                    if (doc.exists) {
                        const data = doc.data();
                        console.log('Datos crudos del snapshot:', JSON.stringify(data, null, 2));

                        const turnosData = data.data || {};
                        console.log('turnosData extraído:', JSON.stringify(turnosData, null, 2));

                        console.log('📡 Llamando al callback con los datos...');
                        callback(turnosData);
                        console.log('📡 Callback ejecutado correctamente');
                    } else {
                        console.log('⚠️ Documento turnosData no existe, usando objeto vacío');
                        callback({});
                    }
                },
                (error) => {
                    console.error('❌ Error al escuchar turnosData:', error);
                    console.error('Error details:', error.code, error.message);
                    console.error('Error stack:', error.stack);
                }
            );
    } catch (error) {
        console.error('❌ Error al configurar escucha de turnosData:', error);
        console.error('Error stack:', error.stack);
        return () => {}; // Retornar función de limpieza vacía
    }
}

// Función para escuchar reservas por fecha en tiempo real
function escucharReservasPorFechaFirebase(fecha, callback) {
    try {
        if (!db) return () => {};

        console.log('🔧 Escuchando reservas para fecha:', fecha);

        return db.collection('reservas')
            .where('date', '==', fecha)
            .onSnapshot(
                { includeMetadataChanges: false },
                (snapshot) => {
                    if (snapshot.metadata.fromCache) return;

                    console.log('📡 Snapshot recibido de reservas para fecha:', fecha);
                    const reservas = [];
                    snapshot.forEach(doc => reservas.push({ id: doc.id, ...doc.data() }));
                    console.log('📡 Reservas encontradas:', reservas.length);
                    callback(reservas);
                },
                (error) => console.error('Error escuchando reservas por fecha:', error)
            );
    } catch (e) {
        console.error('Error al configurar escucha de reservas por fecha:', e);
        return () => {};
    }
}

// Función para guardar la configuración de reservas por turno
async function guardarConfigReservasPorTurno(cantidad) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        await db.collection('config').doc('reservasPorTurno').set({
            cantidad: cantidad,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Configuración de reservas por turno guardada:', cantidad);
    } catch (error) {
        console.error('Error al guardar configuración de reservas por turno:', error);
        throw error;
    }
}

// Función para obtener la configuración de reservas por turno
async function obtenerConfigReservasPorTurno() {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, usando valor por defecto');
            return 1;
        }
        // Forzar a obtener datos del servidor, no de caché
        const doc = await db.collection('config').doc('reservasPorTurno').get({ source: 'server' });
        const result = doc.exists ? (doc.data().cantidad || 1) : 1;

        console.log('Configuración de reservas por turno obtenida:', result);
        return result;
    } catch (error) {
        console.error('Error al obtener configuración de reservas por turno:', error);
        return 1;
    }
}

// Función para escuchar cambios en tiempo real en la configuración de reservas por turno
function escucharConfigReservasPorTurnoFirebase(callback) {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, no se pueden escuchar configuración');
            return () => {}; // Retornar función de limpieza vacía
        }
        return db.collection('config').doc('reservasPorTurno')
            .onSnapshot((doc) => {
                const data = doc.exists ? doc.data() : { cantidad: 1 };
                callback(data);
            }, (error) => {
                console.error('Error al escuchar configuración de reservas por turno:', error);
            });
    } catch (error) {
        console.error('Error al configurar escucha de configuración:', error);
        return () => {}; // Retornar función de limpieza vacía
    }
}

// Función para guardar la configuración de servicios
async function guardarConfigServicios(configServicios) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        await db.collection('config').doc('servicios').set({
            data: configServicios,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Configuración de servicios guardada');
    } catch (error) {
        console.error('Error al guardar configuración de servicios:', error);
        throw error;
    }
}

// Función para obtener la configuración de servicios
async function obtenerConfigServicios() {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, usando configuración por defecto');
            return {};
        }
        // Forzar a obtener datos del servidor, no de caché
        const doc = await db.collection('config').doc('servicios').get({ source: 'server' });
        const result = doc.exists ? (doc.data().data || {}) : {};

        return result;
    } catch (error) {
        console.error('Error al obtener configuración de servicios:', error);
        return {};
    }
}

// Función para escuchar cambios en tiempo real en la configuración de servicios
function escucharConfigServiciosFirebase(callback) {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, no se pueden escuchar configuración de servicios');
            return () => {}; // Retornar función de limpieza vacía
        }
        return db.collection('config').doc('servicios')
            .onSnapshot((doc) => {
                const data = doc.exists ? (doc.data().data || {}) : {};
                callback(data);
            }, (error) => {
                console.error('Error al escuchar configuración de servicios:', error);
            });
    } catch (error) {
        console.error('Error al configurar escucha de configuración de servicios:', error);
        return () => {}; // Retornar función de limpieza vacía
    }
}

// Función para guardar la configuración de horarios
async function guardarConfigHorariosFirebase(horarios) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        await db.collection('config').doc('horarios').set({
            data: horarios,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Configuración de horarios guardada');
    } catch (error) {
        console.error('Error al guardar configuración de horarios:', error);
        throw error;
    }
}

// Función para obtener la configuración de horarios
async function obtenerConfigHorariosFirebase() {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, usando configuración por defecto');
            return {};
        }
        // Forzar a obtener datos del servidor, no de caché
        const doc = await db.collection('config').doc('horarios').get({ source: 'server' });
        const result = doc.exists ? (doc.data().data || {}) : {};

        return result;
    } catch (error) {
        console.error('Error al obtener configuración de horarios:', error);
        return {};
    }
}

// Función para escuchar cambios en tiempo real en la configuración de horarios
function escucharConfigHorariosFirebase(callback) {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, no se pueden escuchar configuración de horarios');
            return () => {}; // Retornar función de limpieza vacía
        }
        return db.collection('config').doc('horarios')
            .onSnapshot((doc) => {
                const data = doc.exists ? (doc.data().data || {}) : {};
                callback(data);
            }, (error) => {
                console.error('Error al escuchar configuración de horarios:', error);
            });
    } catch (error) {
        console.error('Error al configurar escucha de configuración de horarios:', error);
        return () => {}; // Retornar función de limpieza vacía
    }
}

// Función para guardar los días cerrados
async function guardarDiasCerradosFirebase(diasCerrados) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        await db.collection('config').doc('diasCerrados').set({
            data: diasCerrados,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Días cerrados guardados');
    } catch (error) {
        console.error('Error al guardar días cerrados:', error);
        throw error;
    }
}

// Función para obtener los días cerrados
async function obtenerDiasCerradosFirebase() {
    try {
        if (!db) {
            console.error('Firestore no está inicializado');
            return [];
        }
        // Forzar a obtener datos del servidor, no de caché
        const doc = await db.collection('config').doc('diasCerrados').get({ source: 'server' });
        const result = doc.exists ? (doc.data().data || []) : [];

        return result;
    } catch (error) {
        console.error('Error al obtener días cerrados:', error);
        return [];
    }
}

// Función para escuchar cambios en tiempo real en los días cerrados
function escucharDiasCerradosFirebase(callback) {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, no se pueden escuchar días cerrados');
            return () => {}; // Retornar función de limpieza vacía
        }
        return db.collection('config').doc('diasCerrados')
            .onSnapshot((doc) => {
                const data = doc.exists ? (doc.data().data || []) : [];
                callback(data);
            }, (error) => {
                console.error('Error al escuchar días cerrados:', error);
            });
    } catch (error) {
        console.error('Error al configurar escucha de días cerrados:', error);
        return () => {}; // Retornar función de limpieza vacía
    }
}

// Función para guardar la configuración de turnos
async function guardarConfigTurnosFirebase(configTurnos) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        await db.collection('config').doc('turnosConfig').set({
            data: configTurnos,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Configuración de turnos guardada');
    } catch (error) {
        console.error('Error al guardar configuración de turnos:', error);
        throw error;
    }
}

// Función para obtener la configuración de turnos
async function obtenerConfigTurnosFirebase() {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, usando configuración por defecto');
            return {};
        }
        // Forzar a obtener datos del servidor, no de caché
        const doc = await db.collection('config').doc('turnosConfig').get({ source: 'server' });
        const result = doc.exists ? (doc.data().data || {}) : {};

        return result;
    } catch (error) {
        console.error('Error al obtener configuración de turnos:', error);
        return {};
    }
}

// Función para escuchar cambios en tiempo real en la configuración de turnos
function escucharConfigTurnosFirebase(callback) {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, no se pueden escuchar configuración de turnos');
            return () => {}; // Retornar función de limpieza vacía
        }
        return db.collection('config').doc('turnosConfig')
            .onSnapshot((doc) => {
                const data = doc.exists ? (doc.data().data || {}) : {};
                callback(data);
            }, (error) => {
                console.error('Error al escuchar configuración de turnos:', error);
            });
    } catch (error) {
        console.error('Error al configurar escucha de configuración de turnos:', error);
        return () => {}; // Retornar función de limpieza vacía
    }
}

// Función para guardar un ingreso en Firebase
async function guardarIngresoFirebase(ingreso) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        const docRef = await db.collection('ingresos').add({
            ...ingreso,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Ingreso guardado con ID:', docRef.id);
        return docRef.id;
    } catch (error) {
        console.error('Error al guardar ingreso:', error);
        throw error;
    }
}

// Función para obtener ingresos de un día específico
async function obtenerIngresosPorFecha(fecha) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        // Forzar a obtener datos del servidor, no de caché
        const snapshot = await db.collection('ingresos')
            .where('fecha', '==', fecha)
            .get({ source: 'server' });

        const ingresos = [];
        snapshot.forEach(doc => {
            ingresos.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return ingresos;
    } catch (error) {
        console.error('Error al obtener ingresos por fecha:', error);
        return [];
    }
}

// Función para obtener el total de ingresos de un día
async function obtenerTotalIngresosPorFecha(fecha) {
    try {
        const ingresos = await obtenerIngresosPorFecha(fecha);
        const total = ingresos.reduce((sum, ingreso) => {
            const monto = parseInt(String(ingreso.monto).replace(/[^0-9]/g, '')) || 0;
            return sum + monto;
        }, 0);
        return total;
    } catch (error) {
        console.error('Error al calcular total de ingresos:', error);
        return 0;
    }
}

// Función para obtener ingresos de un rango de fechas
async function obtenerIngresosPorRango(fechaInicio, fechaFin) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        // Forzar a obtener datos del servidor, no de caché
        const snapshot = await db.collection('ingresos')
            .where('fecha', '>=', fechaInicio)
            .where('fecha', '<=', fechaFin)
            .get({ source: 'server' });

        const ingresos = [];
        snapshot.forEach(doc => {
            ingresos.push({
                id: doc.id,
                ...doc.data()
            });
        });

        return ingresos;
    } catch (error) {
        console.error('Error al obtener ingresos por rango:', error);
        return [];
    }
}

// Función para obtener el total de ingresos de un rango de fechas
async function obtenerTotalIngresosPorRango(fechaInicio, fechaFin) {
    try {
        const ingresos = await obtenerIngresosPorRango(fechaInicio, fechaFin);
        const total = ingresos.reduce((sum, ingreso) => {
            const monto = parseInt(String(ingreso.monto).replace(/[^0-9]/g, '')) || 0;
            return sum + monto;
        }, 0);
        return total;
    } catch (error) {
        console.error('Error al calcular total de ingresos por rango:', error);
        return 0;
    }
}

// Función para obtener ingresos de la semana actual
async function obtenerIngresosSemanaActual() {
    try {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 = domingo, 1 = lunes, etc.

        // Calcular el inicio de la semana (lunes)
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

        // Calcular el fin de la semana (domingo)
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);

        const fechaInicio = startOfWeek.toISOString().split('T')[0];
        const fechaFin = endOfWeek.toISOString().split('T')[0];

        return await obtenerTotalIngresosPorRango(fechaInicio, fechaFin);
    } catch (error) {
        console.error('Error al obtener ingresos de la semana actual:', error);
        return 0;
    }
}

// Función para obtener ingresos del mes actual
async function obtenerIngresosMesActual() {
    try {
        const today = new Date();
        const year = today.getFullYear();
        const month = today.getMonth();

        // Primer día del mes
        const startOfMonth = new Date(year, month, 1);
        const fechaInicio = startOfMonth.toISOString().split('T')[0];

        // Último día del mes
        const endOfMonth = new Date(year, month + 1, 0);
        const fechaFin = endOfMonth.toISOString().split('T')[0];

        return await obtenerTotalIngresosPorRango(fechaInicio, fechaFin);
    } catch (error) {
        console.error('Error al obtener ingresos del mes actual:', error);
        return 0;
    }
}

// Función para escuchar cambios en tiempo real en los ingresos
function escucharIngresosFirebase(callback) {
    try {
        if (!db) {
            console.error('Firestore no está inicializado, no se pueden escuchar ingresos');
            return () => {}; // Retornar función de limpieza vacía
        }
        return db.collection('ingresos')
            .orderBy('createdAt', 'desc')
            .onSnapshot((snapshot) => {
                const ingresos = [];
                snapshot.forEach(doc => {
                    ingresos.push({
                        id: doc.id,
                        ...doc.data()
                    });
                });
                callback(ingresos);
            }, (error) => {
                console.error('Error al escuchar ingresos:', error);
            });
    } catch (error) {
        console.error('Error al configurar escucha de ingresos:', error);
        return () => {}; // Retornar función de limpieza vacía
    }
}

// ==================== FUNCIONES DE WHATSAPP (ULTRAMSG) ====================

// Configuración de Ultramsg
const ULTRAMSG_CONFIG = {
    instanceId: 'instance175174',
    token: 'b20m4e2zyalbi4r2',
    apiUrl: 'https://api.ultramsg.com'
};

// Función para formatear número de teléfono para WhatsApp
function formatearNumeroWhatsApp(numero) {
    try {
        // Eliminar espacios, guiones y paréntesis
        let limpio = numero.replace(/[\s\-\(\)]/g, '');

        // Eliminar el + si existe
        limpio = limpio.replace(/^\+/, '');

        // Si no tiene código de país, agregar 598 (Uruguay)
        if (!limpio.startsWith('598')) {
            limpio = '598' + limpio;
        }

        return limpio;
    } catch (error) {
        console.error('Error al formatear número:', error);
        return numero;
    }
}

// Función para enviar mensaje de WhatsApp
async function enviarWhatsApp(numero, mensaje) {
    try {
        const numeroFormateado = formatearNumeroWhatsApp(numero);
        const url = `${ULTRAMSG_CONFIG.apiUrl}/${ULTRAMSG_CONFIG.instanceId}/messages/chat`;

        console.log('=== ENVIANDO WHATSAPP ===');
        console.log('Número original:', numero);
        console.log('Número formateado:', numeroFormateado);
        console.log('URL:', url);
        console.log('Mensaje:', mensaje);
        console.log('Token:', ULTRAMSG_CONFIG.token ? 'Presente' : 'Faltante');
        console.log('Instance ID:', ULTRAMSG_CONFIG.instanceId);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                token: ULTRAMSG_CONFIG.token,
                to: numeroFormateado,
                body: mensaje
            })
        });

        console.log('Response status:', response.status);
        console.log('Response ok:', response.ok);

        const result = await response.json();

        console.log('Response body:', result);

        if (result.sent) {
            console.log('✅ WhatsApp enviado exitosamente:', result);
            return { success: true, messageId: result.id };
        } else {
            console.error('❌ Error al enviar WhatsApp:', result);
            return { success: false, error: result };
        }
    } catch (error) {
        console.error('❌❌ Error al enviar WhatsApp:', error);
        console.error('Error message:', error?.message || 'Error desconocido');
        console.error('Error stack:', error?.stack || 'No stack disponible');
        return { success: false, error: error?.message || 'Error desconocido' };
    }
}

// Función para generar mensaje de confirmación de reserva
function generarMensajeConfirmacion(reserva) {
    // Manejar diferentes nombres de campos
    const nombre = reserva.nombre || reserva.name || 'Cliente';
    const telefono = reserva.telefono || reserva.phone || 'No especificado';
    const fecha = reserva.fecha || reserva.date || new Date().toISOString().split('T')[0];

    // Usar hora de llegada si está disponible, si no usar hora normal
    const hora = reserva.arrivalTime || reserva.hora || reserva.timeSlot || 'No especificado';

    // Manejar servicios (puede ser string o array)
    let servicio = 'No especificado';
    if (typeof reserva.servicio === 'string') {
        servicio = reserva.servicio;
    } else if (Array.isArray(reserva.services) && reserva.services.length > 0) {
        servicio = reserva.services.map(s => s.name || s).join(', ');
    }

    // Parsear la fecha manualmente para evitar problemas de zona horaria
    const [year, month, day] = fecha.split('-').map(Number);
    const fechaFormateada = new Date(year, month - 1, day).toLocaleDateString('es-UY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return `✅ *RESERVA CONFIRMADA*

👤 *Cliente:* ${nombre}
💇 *Servicio:* ${servicio}
📅 *Fecha:* ${fechaFormateada}
⏰ *Hora de llegada:* ${hora}

🙏 Gracias por confiar en nosotros!

Si necesitas cancelar o modificar tu reserva, por favor contáctanos.`;
}

// Función para enviar confirmación de WhatsApp
async function enviarConfirmacionWhatsApp(reserva) {
    try {
        console.log('=== ENVIANDO CONFIRMACIÓN DE WHATSAPP ===');
        console.log('Datos de reserva:', reserva);

        // Buscar teléfono en ambos campos (phone y telefono)
        const telefono = reserva.telefono || reserva.phone;

        if (!telefono) {
            console.warn('⚠️ No hay teléfono para enviar WhatsApp');
            console.warn('Campos disponibles:', Object.keys(reserva));
            return { success: false, error: 'No hay teléfono' };
        }

        console.log('📱 Teléfono encontrado:', telefono);

        const mensaje = generarMensajeConfirmacion(reserva);
        console.log('Mensaje generado:', mensaje);

        const resultado = await enviarWhatsApp(telefono, mensaje);

        console.log('Resultado del envío:', resultado);

        return resultado;
    } catch (error) {
        console.error('❌❌ Error al enviar confirmación de WhatsApp:', error);
        console.error('Error message:', error?.message || 'Error desconocido');
        console.error('Error stack:', error?.stack || 'No stack disponible');
        return { success: false, error: error?.message || 'Error desconocido' };
    }
}

// Función para guardar configuración de WhatsApp
async function guardarConfiguracionWhatsApp(config) {
    try {
        if (!db) {
            throw new Error('Firestore no está inicializado');
        }
        await db.collection('config').doc('whatsapp').set({
            ...config,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log('Configuración de WhatsApp guardada');
    } catch (error) {
        console.error('Error al guardar configuración de WhatsApp:', error);
        throw error;
    }
}

// Función para obtener configuración de WhatsApp
async function obtenerConfiguracionWhatsApp() {
    try {
        if (!db) {
            console.error('Firestore no está inicializado');
            return null;
        }
        // Forzar a obtener datos del servidor, no de caché
        const doc = await db.collection('config').doc('whatsapp').get({ source: 'server' });
        return doc.exists ? doc.data() : null;
    } catch (error) {
        console.error('Error al obtener configuración de WhatsApp:', error);
        return null;
    }
}

// Función para escuchar cambios en la configuración de WhatsApp
function escucharConfiguracionWhatsApp(callback) {
    try {
        if (!db) {
            console.error('Firestore no está inicializado');
            return () => {};
        }
        return db.collection('config').doc('whatsapp')
            .onSnapshot((doc) => {
                const data = doc.exists ? doc.data() : null;
                callback(data);
            }, (error) => {
                console.error('Error al escuchar configuración de WhatsApp:', error);
            });
    } catch (error) {
        console.error('Error al configurar escucha de WhatsApp:', error);
        return () => {};
    }
}

// Hacer funciones de WhatsApp disponibles globalmente
window.formatearNumeroWhatsApp = formatearNumeroWhatsApp;
window.enviarWhatsApp = enviarWhatsApp;
window.enviarConfirmacionWhatsApp = enviarConfirmacionWhatsApp;
window.generarMensajeConfirmacion = generarMensajeConfirmacion;
window.guardarConfiguracionWhatsApp = guardarConfiguracionWhatsApp;
window.obtenerConfiguracionWhatsApp = obtenerConfiguracionWhatsApp;
window.escucharConfiguracionWhatsApp = escucharConfiguracionWhatsApp;

console.log('✅ Funciones de WhatsApp cargadas y disponibles globalmente');