window.CASA_GLICK_SHOP_SECTION_SCHEMA = [
  { key:'hero', label:'Hero principal', description:'Portada superior de la tienda.', icon:'layout-template', lockedPosition:'first', fields:[
    {key:'imageUrl',label:'Imagen de escritorio',type:'image'}
  ], defaults:{enabled:true,imageUrl:'assets/hero-desk-casa-glick.png'} },
  { key:'products', label:'Productos', description:'Bloque principal del catálogo.', icon:'shopping-bag', fields:[
    {key:'title',label:'Título',type:'text'}, {key:'description',label:'Descripción',type:'textarea',wide:true},
    {key:'buttonText',label:'Texto del botón',type:'text'}, {key:'buttonUrl',label:'Enlace del botón',type:'text'}
  ], defaults:{enabled:true,title:'Piezas que elevan cada espacio.',description:'Explora nuestra curaduría de mobiliario y decoración para proyectos residenciales, comerciales y de hospitality.',buttonText:'Ver todo',buttonUrl:'productos.html?filter=todo'} },
  { key:'about', label:'About', description:'Presentación e historia de Casa Glick.', icon:'landmark', fields:[
    {key:'title',label:'Título',type:'text'}, {key:'description',label:'Descripción',type:'textarea',wide:true},
    {key:'imageUrl',label:'Imagen',type:'image'}, {key:'buttonText',label:'Texto del botón',type:'text'}, {key:'buttonUrl',label:'Enlace del botón',type:'text'}
  ], defaults:{enabled:true,title:'Casa Glick',description:'Integramos diseño, fabricación, suministro e instalación para desarrollar espacios donde cada detalle responde a una misma visión.\nUn equipo que coordina cada etapa para lograr resultados consistentes y una ejecución impecable.',imageUrl:'assets/about-materials-final.webp',buttonText:'Descubre nuestro enfoque',buttonUrl:'#about-modal'} },
  { key:'brands', label:'Lifestyle', description:'Bloque de ambientes e inspiración.', icon:'badge-check', fields:[
    {key:'imageUrl',label:'Imagen principal',type:'image'}
  ], defaults:{enabled:true,imageUrl:'assets/lifestyle-reading-chair.webp'} },
  { key:'hospitality', label:'Hospitality', description:'Soluciones para hoteles, restaurantes y desarrollos.', icon:'hotel', fields:[
    {key:'title',label:'Título',type:'text'}, {key:'description',label:'Descripción',type:'textarea',wide:true},
    {key:'imageUrl',label:'Imagen',type:'image'}, {key:'buttonText',label:'Texto del botón',type:'text'},
    {key:'buttonUrl',label:'Enlace del botón',type:'text'}
  ], defaults:{enabled:true,title:'Hospitality',description:'Integramos soluciones de mobiliario para hoteles, restaurantes, desarrollos y espacios comerciales, cuidando cada detalle desde la selección hasta la instalación.\nUn enfoque coordinado que combina diseño, funcionalidad y ejecución para crear espacios memorables y consistentes.',imageUrl:'assets/hospitality-lounge.webp',buttonText:'Conocer Hospitality',buttonUrl:'#hospitality-modal'} },
  { key:'showroom', label:'Showroom', description:'Invitación a visitar el showroom.', icon:'store', fields:[
    {key:'title',label:'Título',type:'text'}, {key:'description',label:'Descripción',type:'textarea',wide:true},
    {key:'imageUrl',label:'Imagen',type:'image'}, {key:'buttonText',label:'Texto del botón',type:'text'}, {key:'buttonUrl',label:'Enlace del botón',type:'text'}
  ], defaults:{enabled:true,title:'Vive CASA GLICK | en persona',description:'Descubre una selección curada de mobiliario, materiales y soluciones integrales en un espacio diseñado para inspirar cada proyecto.',imageUrl:'assets/about-materials-correct.webp',buttonText:'Visitar showroom',buttonUrl:'https://wa.me/525513004665?text=Quiero%20conocer%20el%20showroom'} },
  { key:'contact', label:'Contacto', description:'Cierre y llamada a contacto.', icon:'message-square', lockedPosition:'last', fields:[
    {key:'eyebrow',label:'Eyebrow / texto pequeño',type:'text'}, {key:'title',label:'Título',type:'text'},
    {key:'imageUrl',label:'Imagen',type:'image'}, {key:'buttonText',label:'Texto del botón',type:'text'}
  ], defaults:{enabled:true,eyebrow:'Contacto',title:'Déjanos ayudarte con tu compra.',imageUrl:'assets/contact-design-worktable.png',buttonText:'Enviar'} }
];
