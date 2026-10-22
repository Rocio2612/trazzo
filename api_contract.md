Trazzo · Contrato de API Página 1
Contrato de API — Trazzo
Documento de coordinación entre Backend y Frontend
Este documento es el acuerdo entre Backend (Aldi y Rocío C) y Frontend (Nuria y Rocío A). Define
exactamente qué rutas existen, qué datos reciben y qué datos devuelven.
URL Base http://192.168.1.43:5000/api
Header JWT Authorization: Bearer <token> cuando la ruta requiere autenticación
Módulo 1: Autenticación
1. Registro de Negocio (y Admin)
Método POST
Ruta /auth/registro
Requiere JWT No
¿Qué hace? Crea el negocio y al primer usuario (Admin). Devuelve los tokens para que
entre directamente.
Datos que envía el Frontend (JSON):
```json{
 "id_negocio": "mi_negocio_2026",
 "usuario": "rocio_admin",
 "password": "Password123!",
 "correo": "rocio@correo.com",
 "nombre_negocio": "Trazzo Store",
 "rubro": "Indumentaria"
}```
Respuesta exitosa (201 Created):
{
 "status": "ok",
 "mensaje": "Negocio y usuario creado",
 "access_token": "eyJhbGciOi...",
 "refresh_token": "eyJhbGciOi...",
 "usuario": {
 "id": 1,
 "rol": "ADMIN",
 "negocio_id": 10
 }
}
Respuesta de error (400 Bad Request o 409 Conflict):
{
 "status": "error",
 "mensaje": "El identificador de negocio ya está en uso",
 "campo": "id_negocio"
}
Trazzo · Contrato de API Página 2
2. Inicio de Sesión (Login)
Método POST
Ruta /auth/login
Requiere JWT No
¿Qué hace? Verifica las credenciales del usuario y devuelve los tokens necesarios para
acceder al sistema.
Datos que envía el Frontend (JSON):
{
 "id_negocio": "mi_negocio_2026",
 "usuario": "rocio_admin",
 "password": "Password123!"
}
Respuesta exitosa (200 OK):
{
 "status": "ok",
 "access_token": "eyJhbGciOi...",
 "refresh_token": "eyJhbGciOi...",
 "usuario": {
 "id": 1,
 "rol": "ADMIN",
 "nombre": "Rocío"
 }
}
Respuesta de error (401 Unauthorized):
{
 "status": "error",
 "mensaje": "Negocio, usuario o contraseña incorrectos"
}
3. Refrescar Token (Refresh)
Método POST
Ruta /auth/refresh
Requiere JWT No requiere Access Token en el Header; requiere Refresh Token en el Body.
¿Qué hace? Cuando el access_token vence (a los 15 minutos), el Frontend usa el
refresh_token para solicitar uno nuevo sin volver a ingresar la contraseña.
Datos que envía el Frontend (JSON):
{
 "refresh_token": "eyJhbGciOi..."
}
Respuesta exitosa (200 OK):
{
 "status": "ok",
 "access_token": "eyJhbGciOi... (NUEVO TOKEN)"
}
Respuesta de error (401 Unauthorized):
{
 "status": "error",
 "mensaje": "Refresh token inválido o vencido"
}
Trazzo · Contrato de API Página 3
4. Cerrar Sesión (Logout)
Método POST
Ruta /auth/logout
Requiere JWT Sí (Access Token en el Header).
¿Qué hace? Invalida la sesión en el servidor. Si se implementa una lista negra de tokens en
PostgreSQL, el token invalidado no podrá volver a utilizarse.
Headers que envía el Frontend:
Authorization: Bearer <access_token>
Datos que envía el Frontend: Ninguno en el Body.
Respuesta exitosa (200 OK):
{
 "status": "ok",
 "mensaje": "Sesión cerrada correctamente"
}
Respuesta de error (401 Unauthorized):
{
 "status": "error",
 "mensaje": "Token inválido, vencido o no proporcionado"
}
5. Recuperar Contraseña (Enviar Correo)
Método POST
Ruta /auth/recuperar
Requiere JWT No.
¿Qué hace? Recibe un correo electrónico, genera un token de recuperación de un solo uso
con una validez de 30 minutos y envía un correo con el enlace para restablecer
la contraseña.
Datos que envía el Frontend (JSON):
{
 "correo": "rocio@correo.com"
}
Respuesta exitosa (200 OK):
{
 "status": "ok",
 "mensaje": "Si el correo existe, recibirás un mensaje"
}
Respuesta de error (400 Bad Request):
{
 "status": "error",
 "mensaje": "El formato del correo electrónico no es válido"
}
Trazzo · Contrato de API Página 4
6. Restablecer Contraseña (Cambiar Clave)
Método POST
Ruta /auth/restablecer
Requiere JWT No. Requiere el token de recuperación enviado en el enlace del correo
electrónico.
¿Qué hace? Valida el token de recuperación y actualiza la contraseña del usuario. El token
debe ser válido, no haber vencido y no haberse utilizado previamente.
Datos que envía el Frontend (JSON):
{
 "token_recuperacion": "abc123xyz...",
 "nueva_password": "NuevaPassword123!"
}
Respuesta exitosa (200 OK):
{
 "status": "ok",
 "mensaje": "Contraseña actualizada correctamente"
}
Respuesta de error (400 Bad Request):
{
 "status": "error",
 "mensaje": "El token de recuperación es inválido, venció o ya fue utilizado"
}
Consideraciones generales
Formato de las respuestas
Todas las respuestas deben utilizar JSON y mantener una estructura consistente.
Respuesta exitosa:
{
 "status": "ok",
 "mensaje": "Operación realizada correctamente"
}
Respuesta de error:
{
 "status": "error",
 "mensaje": "Descripción del error"
}
Trazzo · Contrato de API Página 5
Códigos HTTP
Código Significado
200 OK Solicitud procesada correctamente.
201 Created Recurso creado correctamente.
400 Bad Request Datos enviados incorrectos o incompletos.
401 Unauthorized Falta autenticación o las credenciales son inválidas.
403 Forbidden El usuario no tiene permisos para realizar la operación.
404 Not Found El recurso solicitado no existe.
409 Conflict Conflicto con un recurso existente, por ejemplo, un identificador de negocio
duplicado.
500 Internal Server Error Error inesperado del servidor.
Autenticación mediante JWT
• Las rutas que requieren autenticación deben recibir el Access Token mediante el encabezado
Authorization.
• El formato del encabezado es Authorization: Bearer <access_token>.
• El Access Token tendrá una duración de 15 minutos, según lo establecido en este contrato.
• El Refresh Token se utilizará exclusivamente para solicitar nuevos Access Tokens.
• Los tokens deben validarse en el Backend antes de permitir el acceso a recursos protegidos.
• Los tokens y las contraseñas no deben registrarse en logs ni exponerse en mensajes de error.
• Las contraseñas deben almacenarse utilizando un algoritmo seguro de hash, nunca en texto plano.
Responsabilidades del equipo
Backend (Aldi y Rocío C):
• Implementar las seis rutas definidas en este documento utilizando Python.
• Validar los datos recibidos y las credenciales de los usuarios.
• Generar y verificar los tokens JWT.
• Gestionar los errores y devolver los códigos HTTP correspondientes.
• Conectar las rutas con la base de datos PostgreSQL.
• Implementar el envío de correos para la recuperación de contraseñas.
Frontend (Nuria y Rocío A):
• Implementar las pantallas de autenticación.
• Enviar las solicitudes HTTP con los datos definidos en este contrato.
• Interpretar las respuestas JSON y mostrar los mensajes correspondientes.
• Gestionar el almacenamiento y envío de los tokens de autenticación de forma segura.
• Manejar los errores devueltos por el Backend.
Trazzo · Contrato de API Página 6
Pantallas relacionadas
Pantalla Archivo HTML Ruta de la API
Inicio de sesión login.html POST /auth/login
Registro de negocio registro.html POST /auth/registro
Recuperar contraseña recuperar.html POST /auth/recuperar
Restablecer contraseña restablecer.html POST /auth/restablecer
Las operaciones de refresco de tokens y cierre de sesión se ejecutarán desde la lógica de autenticación
del Frontend.
¿Por qué es importante este documento?
Este contrato establece un acuerdo común entre los equipos de Backend y Frontend. Ambos trabajarán
con las mismas rutas, estructuras JSON, códigos HTTP y reglas de autenticación.
De esta manera, el equipo de Frontend sabe exactamente qué datos debe enviar y qué respuestas
debe interpretar, mientras que el equipo de Backend conoce las seis rutas que debe implementar en
Python.
Importante: La URL base, los tiempos de expiración de los tokens, los nombres de los campos y las
reglas de validación deben mantenerse coordinados entre ambos equipos. Cualquier modificación del
contrato debe comunicarse y acordarse antes de implementarse.