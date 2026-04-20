# Karaoke App Web

Aplicación web para gestión de cola de karaoke. Permite a los usuarios buscar canciones, registrarse en la cola y llevar un seguimiento de los participantes.

---

## Características principales

- **Pantalla de usuario** (`/`): inicio de sesión, búsqueda de canciones del catálogo, registro manual, visualización de colas (catálogo, manual y mixta) y sugerencias de canciones.
- **Pantalla de administrador** (`/admin.html`): gestión de la cola, configuración de contraseñas, habilitación de secciones por usuario y modos de cola pública.
- **Pantalla pública** (`/public_screen.html`): vista para proyectar el estado actual de la cola en pantalla grande.

---

## Sesión de usuario y botón "Cerrar sesión"

### Estancia estable (persistencia de sesión)

Al iniciar sesión correctamente, las credenciales se guardan en `localStorage` bajo la clave `karaokeSession`. Esto permite que:

- Al **recargar la página**, el usuario permanece en sesión de forma automática (sin necesidad de volver a ingresar sus datos) siempre que las credenciales sigan siendo válidas.
- El usuario **solo sale de la sesión** al presionar el botón **"Cerrar sesión"** o si el servidor rechaza sus credenciales (por ejemplo, si la contraseña fue cambiada por el administrador).

### Botón "Cerrar sesión"

Cuando el usuario está logueado, aparece el botón **"Cerrar sesión"** en la barra de botones superior (`#user-content > .top-buttons`). Al presionarlo:

1. Se detienen todos los intervalos de refresco (colas, public-info).
2. Se limpia el estado de sesión en memoria y en `localStorage`.
3. Se borran los contenidos de colas y resultados de búsqueda.
4. La UI regresa al estado pre-login: se muestra la tarjeta de inicio de sesión (`#login-card`) y se oculta el contenido de usuario (`#user-content`).

### Comportamiento ante fallos de red

- Si un refresco periódico de `/api/public-info` falla (error de red), **no se fuerza el cierre de sesión**; el error se registra en consola y se reintenta en el siguiente ciclo.
- Si al restaurar la sesión desde `localStorage` hay un error de red, la UI se reconstruye de todos modos para mantener la estancia estable.

---

## Instalación y arranque

```bash
npm install
node server.js
```

El servidor corre en el puerto definido en la variable de entorno `PORT` (por defecto `3000`).

---

## Estructura de archivos clave

```
public/
  index.html       # Pantalla de usuario
  main.js          # Lógica del usuario (login, logout, colas, búsqueda)
  admin.html       # Pantalla de administrador
  admin.js         # Lógica del administrador
  public_screen.html  # Pantalla pública (proyección)
  public_screen.js
server.js          # API y servidor Express
```
