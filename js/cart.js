(function(){
  const KEY='casaGlickCartV1';
  const read=()=>{try{const value=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(value)?value:[]}catch{return[]}};
  const write=items=>{localStorage.setItem(KEY,JSON.stringify(items));updateCount();window.dispatchEvent(new CustomEvent('casa-glick:cart-updated',{detail:{items}}));};
  const updateCount=()=>{const count=read().reduce((sum,item)=>sum+(Number(item.quantity)||0),0);document.querySelectorAll('[data-cart-count]').forEach(node=>{node.textContent=String(count);node.hidden=count<1})};
  const add=product=>{const items=read();const id=String(product.id||product.code);const found=items.find(item=>String(item.id)===id);const max=Math.max(1,Number(product.stock)||1);if(found)found.quantity=Math.min(max,(Number(found.quantity)||1)+1);else items.push({id,code:product.code,name:product.name,price:Number(product.price),image:product.image,stock:max,quantity:1});write(items);return items};
  const setQuantity=(id,quantity)=>{const items=read();const item=items.find(x=>String(x.id)===String(id));if(!item)return items;item.quantity=Math.max(1,Math.min(Number(item.stock)||99,Number(quantity)||1));write(items);return items};
  const remove=id=>{const items=read().filter(x=>String(x.id)!==String(id));write(items);return items};
  const clear=()=>write([]);
  window.CasaGlickCart={read,write,add,setQuantity,remove,clear,updateCount};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',updateCount);else updateCount();
})();
