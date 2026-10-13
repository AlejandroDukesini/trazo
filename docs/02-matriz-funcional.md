# 02 · Matriz funcional

Leyenda de nivel: **MVP** (imprescindible para lanzar), **Completo** (paridad funcional razonable), **Avanzado**.
Plan: **F** = gratuito, **P** = premium (configurado en `packages/core/src/plans.ts`, validado en backend).

El estado real de implementación se mantiene en [`ESTADO.md`](../ESTADO.md); esta tabla describe el producto objetivo.

| Área | Capacidad | Nivel | Plan |
|---|---|---|---|
| Registro | Grabar carrera/bici/caminata/senderismo/+ deportes extensibles | MVP | F |
| Registro | Pausa/reanudación/finalización, recuperación tras cierre | MVP | F |
| Registro | GPS en segundo plano con pantalla apagada (Android nativo) | MVP | F |
| Registro | Filtro de GPS (precisión, saltos imposibles, duplicados) | MVP | F |
| Registro | Vueltas manuales y parciales automáticos por km/milla | MVP | F |
| Registro | FC / potencia de sensores BLE | Avanzado | F |
| Registro | Actividad manual (sin GPS) | MVP | F |
| Archivos | Importar GPX/TCX, exportar GPX/TCX | MVP | F |
| Historial | Lista cronológica, búsqueda y filtros | MVP | F |
| Historial | Detalle con mapa, gráficos de ritmo/velocidad/elevación/FC/potencia | MVP | F |
| Historial | Comparación entre dos actividades | Completo | P |
| Estadísticas | Resúmenes semana/mes/año | MVP | F |
| Estadísticas | Comparativa entre periodos, histórico ampliado (> 12 meses) | Completo | P |
| Récords | Mejores esfuerzos (400 m, 1 km, 5 km, 10 km, media, maratón; 5/20/40 km bici) | Completo | F |
| Mapas | Visualización de recorrido, capas claro/oscuro | MVP | F |
| Rutas | Crear/editar rutas con puntos intermedios, distancia, perfil de elevación | Completo | F (básico) / P (routing automático por caminos) |
| Rutas | Búsqueda de lugares | Completo | F |
| Rutas | Importar/exportar GPX de ruta, favoritas | Completo | F |
| Rutas | Navegación durante actividad (seguir trazado) | Avanzado | P |
| Rutas | Mapas offline | Avanzado | P (bloqueado por licencia) |
| Segmentos | Crear segmento desde actividad, detección automática de intentos | Completo | F |
| Segmentos | Clasificación completa, filtros por periodo | Completo | P (F ve top 10 y su posición) |
| Entrenamiento | Objetivos semanales (distancia/tiempo/desnivel/frecuencia) | MVP | F |
| Entrenamiento | Objetivos mensuales/anuales y múltiples | Completo | P |
| Entrenamiento | Zonas FC configurables, tiempo en zona | Completo | P |
| Entrenamiento | Carga (TRIMP), fitness/fatiga (CTL/ATL/TSB) | Avanzado | P |
| Entrenamiento | Planes de entrenamiento configurables | Avanzado | P |
| Social | Registro, perfil, avatar, biografía, preferencias | MVP | F |
| Social | Seguir / seguidores, cuentas privadas con solicitud | MVP | F |
| Social | Feed, reacciones, comentarios | MVP | F |
| Social | Fotos en actividades | Completo | F |
| Social | Clubes públicos/privados, invitaciones | Completo | F (crear club avanzado: P) |
| Social | Retos individuales y de club, clasificación | Completo | F |
| Social | Notificaciones in-app | MVP | F |
| Social | Bloqueo, denuncia y cola de moderación | MVP | F |
| Privacidad | Visibilidad por actividad (pública/seguidores/solo yo) | MVP | F |
| Privacidad | Zonas privadas (ocultar inicio/fin cerca de casa) | MVP | F |
| Privacidad | Exportación y eliminación de cuenta (RGPD) | MVP | F |
| Suscripción | Stripe web, Google Play Billing, entitlements en servidor | Completo | — |
| Plataformas | PWA instalable + offline + cola de sincronización | MVP | — |
| Plataformas | Android (Capacitor) | MVP | — |
| Plataformas | Windows (Tauri) | Completo | — |
