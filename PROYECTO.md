# 📌 Alcance del proyecto — SwimTracker Pro

## ¿Qué es esta aplicación?
**SwimTracker Pro** es un proyecto **PERSONAL / de aficionado**, creado para uso de **una sola familia**:

- 👨 Papá (dueño del proyecto)
- 👩 Mamá (esposa)
- 🧒 Hija — la nadadora (**Danna**)

Son **3 usuarios**. Uso **privado, no comercial**. Hosting: Vercel (`swimtracker-pro.vercel.app`), datos en Firebase (proyecto `swimtracker-pro`), protegido con login.

---

## ⚠️ Relación con el proyecto del CLUB (¡importante, son DOS proyectos distintos!)

Existe **otro proyecto, separado**, que vive en **otra carpeta / otra sesión de VS Code**:

- Es la aplicación para el **CLUB de natación** (la pidió el entrenador/dueño del club).
- Está pensada para **todos los deportistas/atletas** del club → **multiusuario, de alcance comercial**.
- Es un **producto independiente**: su propio repositorio, su propia base de datos, su propio hosting.

> 🔒 **Regla:** SwimTracker Pro (personal) y la app del Club **NO se mezclan**. No comparten datos ni código directamente. Solo comparten **ideas y plantillas** (como el plan de alimentación).

---

## 🥗 Funcionalidad de alimentación / "Modo Competencia"

La misma idea se implementa **distinto** en cada proyecto:

| | **SwimTracker Pro (personal)** | **App del Club (comercial)** |
|---|---|---|
| Nivel de detalle | **Muy detallado**, personalizado para la hija | **General**, plantilla base para cualquier atleta |
| Avisos | Notifica a los **3 miembros** de la familia | Genérico / configurable por atleta |
| Decisiones tomadas | Avisos: en-app (vista "Hoy") + exportar al calendario del cel · Contenido: plantilla fija | (por definir en su sesión) |

---

## 📝 Notas
- Este documento sirve para no confundir ambos proyectos.
- Cualquier funcionalidad nueva debe indicar si es para **el personal**, **el del club**, o **ambos**.
- El plan de alimentación general (portable) se puede llevar de un proyecto al otro como plantilla.
