(function(){
  const cart=window.CasaGlickCart;
  const money=value=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',minimumFractionDigits:2}).format(Number(value)||0);
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const itemsNode=document.querySelector('[data-cart-items]');
  if(!cart||!itemsNode)return;
  function render(){
    const items=cart.read();
    const count=items.reduce((sum,item)=>sum+(Number(item.quantity)||0),0);
    const subtotal=items.reduce((sum,item)=>sum+(Number(item.price)||0)*(Number(item.quantity)||0),0);
    document.querySelector('[data-cart-summary]').textContent=`${count} ${count===1?'producto':'productos'}`;
    document.querySelector('[data-cart-subtotal]').textContent=money(subtotal);
    document.querySelector('[data-cart-total]').textContent=`${money(subtotal)} MXN`;
    if(!items.length){
      itemsNode.innerHTML='<div class="cart-empty"><h2>Tu bolsa está vacía</h2><p>Explora nuestra colección y agrega las piezas que te interesen.</p><a href="productos.html?filter=todo">Ver productos</a></div>';
    }else{
      itemsNode.innerHTML=items.map(item=>`<article class="cart-item"><a class="cart-item__image" href="producto.html?product=${encodeURIComponent(item.code)}"><img src="${esc(item.image||'assets/product-placeholder-cg.png')}" alt="${esc(item.name)}" onerror="this.src='assets/product-placeholder-cg.png'"></a><div class="cart-item__info"><span>${esc(item.code)}</span><h2>${esc(item.name)}</h2><strong>${money(item.price)}</strong><div class="cart-item__actions"><div class="cart-quantity" aria-label="Cantidad"><button type="button" data-decrease="${esc(item.id)}" aria-label="Reducir cantidad">−</button><span>${Number(item.quantity)||1}</span><button type="button" data-increase="${esc(item.id)}" aria-label="Aumentar cantidad">+</button></div><button class="cart-remove" type="button" data-remove="${esc(item.id)}">Eliminar</button></div></div><div class="cart-item__total">${money((Number(item.price)||0)*(Number(item.quantity)||0))}</div></article>`).join('');
    }
    const checkout=document.querySelector('[data-cart-checkout]');
    checkout.classList.toggle('is-disabled',!items.length);
    checkout.setAttribute('aria-disabled',String(!items.length));
    checkout.href=items.length?'checkout.html':'#';
    cart.updateCount();
  }
  itemsNode.addEventListener('click',event=>{
    const down=event.target.closest('[data-decrease]');
    const up=event.target.closest('[data-increase]');
    const remove=event.target.closest('[data-remove]');
    const items=cart.read();
    if(down){const item=items.find(x=>String(x.id)===down.dataset.decrease);if(item)cart.setQuantity(item.id,Math.max(1,item.quantity-1));}
    if(up){const item=items.find(x=>String(x.id)===up.dataset.increase);if(item)cart.setQuantity(item.id,item.quantity+1);}
    if(remove)cart.remove(remove.dataset.remove);
    render();
  });
  document.querySelector('[data-cart-checkout]').addEventListener('click',event=>{if(!cart.read().length)event.preventDefault()});
  window.addEventListener('casa-glick:cart-updated',render);
  render();
})();
