(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const cfg = window.TAXI_LOCAL_CONFIG || {};
  const ready = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const db = ready ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
  const AREAS = ['Elda','Petrer','Villena','Pinoso','Monóvar','Alicante','Aeropuerto de Alicante-Elche','Puerto de Alicante'];
  const AREA_COORDS = {
    'Elda':[38.4778,-0.7916], 'Petrer':[38.4849,-0.7707], 'Villena':[38.6373,-0.8657],
    'Pinoso':[38.4016,-1.0415], 'Monóvar':[38.4389,-0.8407], 'Alicante':[38.3452,-0.4810],
    'Aeropuerto de Alicante-Elche':[38.2822,-0.5582], 'Puerto de Alicante':[38.3386,-0.4830]
  };
  let session = null, profile = null, channel = null, available = false, toastTimer = null;
  let coords = null, chosenAreas = [], currentRides = [], map = null, mapMarkers = [], trackingTimer = null, authMode = 'signup';
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = v => { if (!v) return 'Lo antes posible'; const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toLocaleString('es-ES',{dateStyle:'medium',timeStyle:'short'}); };
  const phoneLink = v => String(v || '').replace(/[^+\d]/g,'');
  function notify(msg) { const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),3200); }
  function go(name) {
    $$('.screen').forEach(s=>s.classList.toggle('active',s.id===name));
    $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.go===name));
    window.scrollTo({top:0,behavior:'smooth'});
    if(name==='driver' && session) { renderRides(); setTimeout(initMap,100); }
  }
  $$('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
  function renderAreaChecks(root, namePrefix, selected=[]) {
    root.innerHTML = AREAS.map((a,i)=>`<label class="area-option"><input type="checkbox" name="${namePrefix}" value="${esc(a)}" ${selected.includes(a)?'checked':''}><span>${esc(a)}</span></label>`).join('');
  }
  renderAreaChecks($('#signup-areas'),'signupArea',['Elda']);
  renderAreaChecks($('#settings-areas'),'settingsArea',['Elda']);
  $('#signup-areas').addEventListener('change',e=>{if(e.target.matches('input') && e.target.checked){const base=$('#auth-form').elements.homeBase.value; if(!$$('input:checked',$('#signup-areas')).some(x=>x.value===base)) notify('La sede se añadirá automáticamente a tus zonas.');}});
  $('#auth-form').elements.homeBase.addEventListener('change',()=>{});
  function status(msg){$('#account-state').textContent=msg;}
  function setAuthMode(mode) {
    authMode=mode;
    $('#signup-fields').classList.toggle('hidden',mode!=='signup');
    $('#signup-mode').classList.toggle('active',mode==='signup');
    $('#signin-mode').classList.toggle('active',mode==='signin');
    $('#auth-submit').textContent=mode==='signup'?'Crear cuenta de conductor':'Iniciar sesión';
    const form=$('#auth-form');
    ['fullName','phone','homeBase'].forEach(n=>{form.elements[n].required=mode==='signup';form.elements[n].disabled=mode!=='signup';});
    $$('#signup-areas input').forEach(x=>x.disabled=mode!=='signup');
    status(mode==='signup'?'Los conductores deben ser aprobados antes de recibir reservas.':'Introduce el correo y la contraseña de tu cuenta de conductor.');
  }
  $('#signup-mode').addEventListener('click',()=>setAuthMode('signup'));
  $('#signin-mode').addEventListener('click',()=>setAuthMode('signin'));
  function signedIn(){return !!session;}
  async function loadProfile(){
    if(!session){profile=null;return;}
    const {data,error}=await db.from('profiles').select('id,role,full_name,phone,town,is_verified').eq('id',session.user.id).maybeSingle();
    if(error) throw error; profile=data;
  }
  async function loadAreas(){
    if(!session || profile?.role!=='driver') return [];
    const {data,error}=await db.from('driver_service_areas').select('area').eq('driver_id',session.user.id);
    if(error) throw error;
    chosenAreas=(data||[]).map(x=>x.area);
    if(!chosenAreas.length && profile.town) chosenAreas=[profile.town];
    return chosenAreas;
  }
  function updateAuthUI(){
    $('#driver-auth').classList.toggle('hidden',!!session);
    $('#driver-dashboard').classList.toggle('hidden',!session || profile?.role!=='driver');
    if(!session){setAuthMode(authMode);return;}
    if(profile?.role!=='driver'){
      $('#driver-auth').classList.remove('hidden');
      $('#driver-dashboard').classList.add('hidden');
      status('Esta cuenta no es de conductor. Cierra sesión e inicia con una cuenta de conductor.');
      return;
    }
    $('#driver-greeting').textContent=`Hola, ${profile.full_name || 'conductor'}`;
    $('#driver-approval').textContent=profile.is_verified?'Cuenta aprobada. Elige tus zonas y activa tu disponibilidad.':'Tu cuenta está pendiente de aprobación. No podrás aceptar reservas hasta que sea verificada.';
    $('#availability').disabled=!profile.is_verified;
    $('#availability').classList.toggle('on',available);
    $('#availability').setAttribute('aria-pressed',String(available));
    $('#availability').textContent=available?'Desactivar':'Activar';
    $('#driver-status-text').textContent=available?'Disponible':'No disponible';
    $('#settings-base').value=profile.town || 'Elda';
    renderAreaChecks($('#settings-areas'),'settingsArea',chosenAreas.length?chosenAreas:[profile.town||'Elda']);
  }
  async function refreshAuth(){
    if(!ready){status('No se ha podido conectar con Supabase. Comprueba la configuración pública en config.js y ejecuta la migración SQL.');$('#auth-submit').disabled=true;$('#availability').disabled=true;return;}
    const {data}=await db.auth.getSession(); session=data.session;
    try{await loadProfile();if(profile?.role==='driver')await loadAreas();}catch(e){status('No se pudo cargar el perfil: '+e.message);}
    updateAuthUI();
    if(session && profile?.role==='driver') { await loadPresence(); subscribeRides(); }
  }
  async function loadPresence(){
    if(!session)return;
    const {data,error}=await db.from('driver_presence').select('is_available').eq('driver_id',session.user.id).maybeSingle();
    if(!error && data) available=!!data.is_available;
    updateAuthUI();
  }
  async function signUp(){
    const f=$('#auth-form'); if(!f.reportValidity())return;
    if(!ready){notify('La conexión con Supabase no está configurada.');return;}
    const d=new FormData(f), base=d.get('homeBase');
    const areas=$$('input[name="signupArea"]:checked').map(x=>x.value);
    if(!areas.length){notify('Selecciona al menos una zona de trabajo.');return;}
    if(!areas.includes(base))areas.push(base);
    const btn=$('#auth-submit');btn.disabled=true;btn.textContent='Creando cuenta…';status('Creando cuenta de conductor…');
    const {data,error}=await db.auth.signUp({email:String(d.get('email')).trim(),password:d.get('password'),options:{data:{full_name:String(d.get('fullName')).trim(),phone:String(d.get('phone')).trim(),home_base:base,town:base,requested_role:'driver',service_areas:areas}}});
    btn.disabled=false;btn.textContent='Crear cuenta de conductor';
    if(error){status(error.message);return;}
    if(data.session){session=data.session;try{await loadProfile();await loadAreas();}catch(e){status('Cuenta creada, pero no se pudieron cargar los datos: '+e.message);}updateAuthUI();if(profile?.role==='driver')subscribeRides();notify('Cuenta creada. Recuerda que necesita aprobación.');}
    else status('Cuenta creada. Confirma el correo y luego vuelve a iniciar sesión. Las zonas seleccionadas se guardaron con el registro.');
  }
  async function signIn(){
    const f=$('#auth-form');if(!f.reportValidity())return;if(!ready){notify('La conexión con Supabase no está configurada.');return;}
    const d=new FormData(f);status('Iniciando sesión…');
    const {data,error}=await db.auth.signInWithPassword({email:String(d.get('email')).trim(),password:d.get('password')});
    if(error){status(error.message);return;}
    session=data.session;
    try{await loadProfile();if(profile?.role==='driver')await loadAreas();}catch(e){status(e.message);}
    updateAuthUI();
    if(profile?.role!=='driver'){status('Esta cuenta no es de conductor.');await db.auth.signOut();session=null;profile=null;updateAuthUI();return;}
    await loadPresence();subscribeRides();notify('Sesión iniciada.');
  }
  $('#auth-form').addEventListener('submit',e=>{e.preventDefault();authMode==='signup'?signUp():signIn();});
  $('#logout-button').addEventListener('click',async()=>{if(db){if(channel)await db.removeChannel(channel);await db.auth.signOut();}channel=null;session=null;profile=null;available=false;chosenAreas=[];updateAuthUI();$('#rides-list').innerHTML='';notify('Sesión cerrada.');});
  if(ready)db.auth.onAuthStateChange((_event,s)=>{session=s;setTimeout(async()=>{try{await loadProfile();if(profile?.role==='driver')await loadAreas();}catch{}updateAuthUI();if(session&&profile?.role==='driver'){await loadPresence();subscribeRides();}else if(channel){db.removeChannel(channel);channel=null;}},0);});

  $('#gps').addEventListener('click',()=>{
    const out=$('#gps-status');
    if(!navigator.geolocation){out.textContent='Este navegador no ofrece geolocalización. Escribe la dirección manualmente.';return;}
    out.textContent='Solicitando permiso de ubicación…';
    navigator.geolocation.getCurrentPosition(p=>{
      coords={lat:p.coords.latitude,lng:p.coords.longitude};
      $('#ride-form').elements.pickup.value=`Ubicación compartida (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;
      out.textContent='Ubicación lista. Se compartirá con el conductor que acepte tu reserva.';
    },()=>{out.textContent='No se pudo obtener la ubicación. Escribe la dirección manualmente.';},{enableHighAccuracy:true,timeout:12000,maximumAge:60000});
  });
  function savedTracking(){try{return JSON.parse(localStorage.getItem('taxiLocalTracking')||'null');}catch{return null;}}
  function showTrackingResult(item,status='pending',driverPhone=null){
    const result=$('#request-result');result.classList.remove('hidden','accepted','pending');result.classList.add(status==='accepted'?'accepted':'pending');
    const labels={pending:'Buscando conductor disponible',accepted:'Un conductor ha aceptado tu reserva',completed:'Servicio completado',cancelled:'Solicitud cancelada',no_driver:'No se encontró conductor disponible'};
    result.innerHTML=`<strong>${esc(labels[status]||'Estado de la solicitud')}</strong><p>Referencia: <b>${esc(String(item.ride_id).slice(0,8).toUpperCase())}</b></p><p>${esc(status==='accepted'?'Tu taxi ha aceptado el servicio.':status==='pending'?'Tu solicitud está pendiente. Conserva esta referencia para consultar el estado.':'Estado actualizado: '+(labels[status]||status))}</p>${driverPhone?`<p>Contacto del conductor: <a href="tel:${esc(phoneLink(driverPhone))}">${esc(driverPhone)}</a></p>`:''}<button class="secondary" id="check-status" type="button">Consultar estado ↻</button>`;
    $('#check-status').addEventListener('click',()=>checkTracking(item));
  }
  async function checkTracking(item=savedTracking()){
    if(!item?.ride_id||!item?.tracking_token||!ready)return;
    const {data,error}=await db.rpc('get_public_ride_status',{p_ride_id:item.ride_id,p_tracking_token:item.tracking_token});
    if(error){notify('No se pudo consultar el estado ahora.');return;}
    const row=Array.isArray(data)?data[0]:data;
    if(!row){notify('No se encontró la solicitud con esta referencia.');return;}
    showTrackingResult(item,row.status,row.driver_phone||null);
  }
  function startTracking(item){
    if(trackingTimer)clearInterval(trackingTimer);
    try{localStorage.setItem('taxiLocalTracking',JSON.stringify(item));}catch{}
    showTrackingResult(item,'pending');
    checkTracking(item);
    trackingTimer=setInterval(()=>checkTracking(item),15000);
  }
  $('#ride-form').addEventListener('submit',async e=>{
    e.preventDefault();const f=e.currentTarget;if(!f.reportValidity())return;if(!ready){notify('La app no está conectada al servidor. Comprueba config.js.');return;}
    const d=new FormData(f), btn=f.querySelector('[type="submit"]');
    const payload={p_town:d.get('town'),p_pickup_address:String(d.get('pickup')).trim(),p_rider_phone:String(d.get('phone')).trim(),p_destination_address:String(d.get('destination')||'').trim()||null,p_pickup_lat:coords?.lat??null,p_pickup_lng:coords?.lng??null};
    btn.disabled=true;btn.textContent='Enviando solicitud…';
    const {data,error}=await db.rpc('create_public_ride',payload);
    btn.disabled=false;btn.textContent='Solicitar taxi →';
    if(error){notify('No se pudo enviar la solicitud: '+error.message);return;}
    const item=Array.isArray(data)?data[0]:data;
    if(!item?.ride_id||!item?.tracking_token){notify('El servidor no devolvió la referencia de seguimiento.');return;}
    startTracking(item);notify('Solicitud enviada.');$('#request-result').scrollIntoView({behavior:'smooth',block:'center'});
  });

  $('#settings-base').addEventListener('change',e=>{
    const base=e.target.value, root=$('#settings-areas');
    const checkbox=$$('input',root).find(x=>x.value===base);if(checkbox)checkbox.checked=true;
  });
  $('#save-areas').addEventListener('click',async()=>{
    if(!ready||!session||profile?.role!=='driver')return;
    const base=$('#settings-base').value;let areas=$$('input[name="settingsArea"]:checked').map(x=>x.value);
    if(!areas.length){notify('Selecciona al menos una zona.');return;}if(!areas.includes(base))areas.push(base);
    const {error:profileError}=await db.from('profiles').update({town:base}).eq('id',session.user.id);
    if(profileError){notify('No se pudo guardar la sede: '+profileError.message);return;}
    const {error:deleteError}=await db.from('driver_service_areas').delete().eq('driver_id',session.user.id);
    if(deleteError){notify('No se pudieron actualizar las zonas: '+deleteError.message);return;}
    const {error:insertError}=await db.from('driver_service_areas').insert(areas.map(area=>({driver_id:session.user.id,area})));
    if(insertError){notify('Error guardando las zonas: '+insertError.message);return;}
    profile.town=base;chosenAreas=areas;notify('Sede y zonas guardadas.');renderRides();
  });
  $('#availability').addEventListener('click',async()=>{
    if(!ready||!session||profile?.role!=='driver'||!profile.is_verified){notify('Necesitas una cuenta de conductor aprobada.');return;}
    if(!chosenAreas.length){notify('Elige y guarda tus zonas de trabajo primero.');return;}
    const next=!available;
    const {error}=await db.from('driver_presence').upsert({driver_id:session.user.id,town:profile.town,is_available:next,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()});
    if(error){notify('No se pudo actualizar la disponibilidad: '+error.message);return;}
    available=next;updateAuthUI();if(available)subscribeRides();else renderRides();notify(available?'Ahora estás disponible.':'Has desactivado tu disponibilidad.');
  });
  $('#refresh').addEventListener('click',renderRides);
  function rideCard(r){
    const labels={pending:'Pendiente',accepted:'Aceptado',completed:'Completado',cancelled:'Cancelado',no_driver:'Sin conductor'};
    const phone=r.rider_phone?`<b>Teléfono:</b> <a href="tel:${esc(phoneLink(r.rider_phone))}">${esc(r.rider_phone)}</a><br>`:'';
    let actions='';
    if(r.status==='pending')actions=`<button class="accept" data-action="accept" data-id="${esc(r.id)}">Aceptar reserva</button>`;
    if(r.status==='accepted'&&r.driver_id===session?.user?.id)actions=`<button data-action="complete" data-id="${esc(r.id)}">Marcar completada</button>`;
    const mapsUrl=r.pickup_lat!=null&&r.pickup_lng!=null?`https://www.google.com/maps?q=${encodeURIComponent(r.pickup_lat+','+r.pickup_lng)}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.pickup_address+', '+r.town)}`;
    return `<article class="ride-card"><div class="ride-top"><strong>${esc(r.town)} · ${esc(r.pickup_address)}</strong><span class="status-pill status-${esc(r.status)}">${esc(labels[r.status]||r.status)}</span></div><div class="ride-details">${r.destination_address?`<b>Destino:</b> ${esc(r.destination_address)}<br>`:''}${phone}<b>Servicio:</b> Recogida solicitada<br>${r.pickup_lat!=null&&r.pickup_lng!=null?'<b>Ubicación GPS compartida</b><br>':''}<a href="${mapsUrl}" target="_blank" rel="noopener">Ver punto en el mapa ↗</a><br><span class="muted">Creada: ${esc(date(r.created_at))} · Ref. ${esc(r.id.slice(0,8).toUpperCase())}</span></div>${actions?`<div class="ride-actions">${actions}</div>`:''}</article>`;
  }
  async function renderRides(){
    if(!ready||!session||profile?.role!=='driver'){$('#rides-list').innerHTML='<div class="empty">Inicia sesión como conductor para ver las reservas.</div>';return;}
    if(!profile.is_verified){$('#rides-list').innerHTML='<div class="empty">Tu cuenta está pendiente de aprobación. Todavía no puedes recibir reservas.</div>';currentRides=[];updateMapMarkers();return;}
    const areas=chosenAreas.length?chosenAreas:[profile.town];
    let q=db.from('rides').select('id,town,pickup_address,destination_address,pickup_lat,pickup_lng,rider_phone,status,driver_id,created_at').in('town',areas).in('status',['pending','accepted']).order('created_at',{ascending:false}).limit(100);
    const {data,error}=await q;
    if(error){notify('Error cargando reservas: '+error.message);return;}
    currentRides=data||[];
    const {data:allAssigned}=await db.from('rides').select('id,status').eq('driver_id',session.user.id).in('status',['accepted','completed']).limit(100);
    $('#pending-count').textContent=currentRides.filter(r=>r.status==='pending').length;
    $('#accepted-count').textContent=(allAssigned||[]).filter(r=>r.status==='accepted').length;
    $('#completed-count').textContent=(allAssigned||[]).filter(r=>r.status==='completed').length;
    $('#rides-list').innerHTML=currentRides.length?currentRides.map(rideCard).join(''):'<div class="empty">No hay reservas pendientes en tus zonas. Activa tu disponibilidad y vuelve a consultar.</div>';
    $$('[data-action]',$('#rides-list')).forEach(b=>b.addEventListener('click',async()=>{
      const action=b.dataset.action;b.disabled=true;
      const {error}=await db.rpc(action==='accept'?'accept_ride':'complete_ride',{p_ride_id:b.dataset.id});
      b.disabled=false;
      if(error){notify('No se pudo actualizar: '+error.message);return;}
      notify(action==='accept'?'Reserva aceptada. Ya no aparecerá como pendiente para otros conductores.':'Servicio marcado como completado.');
      renderRides();
    }));
    updateMapMarkers();
  }
  function initMap(){
    if(map||!window.L||!$('#driver-map'))return;
    map=L.map('driver-map').setView([38.43,-0.69],9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
    Object.entries(AREA_COORDS).forEach(([name,point])=>L.circleMarker(point,{radius:5,color:'#6c5700',fillColor:'#ffd21f',fillOpacity:.9,weight:1}).addTo(map).bindPopup(`<b>${esc(name)}</b><br>Zona de servicio`));
    updateMapMarkers();
  }
  function updateMapMarkers(){
    if(!map){if($('#map-status'))$('#map-status').textContent='El mapa se cargará al abrir el panel del conductor.';return;}
    mapMarkers.forEach(m=>map.removeLayer(m));mapMarkers=[];
    currentRides.filter(r=>r.status==='pending'&&r.pickup_lat!=null&&r.pickup_lng!=null).forEach(r=>{
      const marker=L.marker([r.pickup_lat,r.pickup_lng]).addTo(map).bindPopup(`<b>${esc(r.town)}</b><br>${esc(r.pickup_address)}<br><small>Ref. ${esc(r.id.slice(0,8).toUpperCase())}</small>`);mapMarkers.push(marker);
    });
    const count=currentRides.filter(r=>r.status==='pending').length;
    const gpsCount=currentRides.filter(r=>r.status==='pending'&&r.pickup_lat!=null&&r.pickup_lng!=null).length;
    $('#map-status').textContent=`${count} reserva(s) pendientes en tus zonas; ${gpsCount} con ubicación GPS marcada. Las direcciones escritas se pueden abrir en el mapa desde cada reserva.`;
    setTimeout(()=>map.invalidateSize(),100);
  }
  function subscribeRides(){
    if(!ready||!session||profile?.role!=='driver')return;
    if(channel)db.removeChannel(channel);
    channel=db.channel('taxi-local-driver-'+session.user.id).on('postgres_changes',{event:'*',schema:'public',table:'rides'},()=>{renderRides();notify('Se han actualizado las reservas.');}).subscribe();
    renderRides();
  }
  if(ready){refreshAuth();}else{status('Supabase no está configurado. Revisa config.js antes de probar solicitudes reales.');$('#auth-submit').disabled=true;$('#ride-form').querySelector('[type="submit"]').disabled=true;}
  const oldTracking=savedTracking();if(oldTracking&&ready){setTimeout(()=>{showTrackingResult(oldTracking,'pending');checkTracking(oldTracking);trackingTimer=setInterval(()=>checkTracking(oldTracking),15000);},500);}
  if('serviceWorker' in navigator&&location.protocol!=='file:')window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
})();
