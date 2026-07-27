# Shop Web Design dinámico v63

- `js/shop-content-schema.js` es el esquema maestro compartido con el Panel.
- Para registrar un bloque nuevo, se agrega su definición a ese archivo y su HTML usa `data-section="clave"`.
- Los campos estándar usan `data-content="clave-title"`, `clave-description`, `clave-image`, `clave-button` y `clave-eyebrow`.
- El Panel detecta el esquema remoto y crea en Firebase las secciones faltantes sin sobrescribir contenido existente.
- El Shop lee `sectionOrder` desde `shopContent/home` y reordena los bloques automáticamente.
- Hero está fijado al inicio y Contacto al final.
