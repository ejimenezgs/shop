const params=new URLSearchParams(location.search);
const sessionId=params.get('session_id');
const statusNode=document.querySelector('#stripe-success-status');
const detailsNode=document.querySelector('#stripe-success-details');
const retryNode=document.querySelector('#stripe-success-retry');
let attempts=0;
const money=value=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(Number(value)||0);
async function verify(){
  if(!sessionId){statusNode.textContent='No encontramos una sesión de pago válida.';return;}
  retryNode.hidden=true;
  statusNode.textContent='Confirmando tu pago…';
  try{
    const response=await fetch(`api/get-checkout-session.php?session_id=${encodeURIComponent(sessionId)}`,{cache:'no-store'});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'No se pudo validar el pago.');
    if(data.confirmed){
      statusNode.textContent='Pago recibido';
      detailsNode.replaceChildren();
      const folioNode=document.createElement('strong');
      const totalNode=document.createElement('span');
      const emailNode=document.createElement('span');
      folioNode.textContent=String(data.folio||'Orden confirmada');
      totalNode.textContent=`${money(data.total)} MXN`;
      emailNode.textContent=String(data.email||'');
      detailsNode.append(folioNode,totalNode,emailNode);
      window.CasaGlickCart?.clear?.();
      sessionStorage.removeItem('casaGlickStripePendingOrder');
      return;
    }
    attempts+=1;
    if(attempts<8){setTimeout(verify,2000);return;}
    statusNode.textContent='Tu pago está siendo confirmado. No cierres esta página o vuelve a intentarlo en unos segundos.';
    retryNode.hidden=false;
  }catch(error){
    statusNode.textContent=error.message||'No fue posible validar el pago.';
    retryNode.hidden=false;
  }
}
retryNode.addEventListener('click',verify);
verify();
