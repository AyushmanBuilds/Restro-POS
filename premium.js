/* Zayka Serve — premium UI helpers. Additive only: it clicks your existing
   buttons and never touches app.js logic or data. */
(function(){
  function init(){
    var shell=document.getElementById('appShell'),bar=document.getElementById('sidebar');
    if(!shell||!bar||document.getElementById('bottomNav'))return;
    var navBtns=[].slice.call(document.querySelectorAll('.nav-item[data-view]'));

    /* live clock in the top bar */
    var clock=document.createElement('div');clock.className='bar-clock';
    bar.insertBefore(clock,document.getElementById('logoutBtn'));
    function tick(){var d=new Date();
      clock.innerHTML='<b>'+d.toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})+'</b><span>'+
        d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'})+'</span>';}
    tick();setInterval(tick,30000);

    /* mobile bottom tab bar — drives the real nav buttons */
    var nav=document.createElement('nav');nav.id='bottomNav';nav.className='bottom-nav';
    [['dashboard','Home'],['tables','Tables'],['kds','Kitchen'],['bills','Bills']].forEach(function(p){
      var src=document.querySelector('.nav-item[data-view="'+p[0]+'"] svg');if(!src)return;
      var b=document.createElement('button');b.dataset.go=p[0];
      b.innerHTML=src.outerHTML+'<span>'+p[1]+'</span>';
      b.onclick=function(){var t=document.querySelector('.nav-item[data-view="'+p[0]+'"]');if(t)t.click();};
      nav.appendChild(b);
    });
    var more=document.createElement('button');more.dataset.go='more';
    more.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg><span>More</span>';
    more.onclick=function(){var h=document.getElementById('hamburgerBtn');if(h)h.click();};
    nav.appendChild(more);shell.appendChild(nav);

    function sync(){
      var a=document.querySelector('.nav-item.active'),v=a?a.dataset.view:'';
      var main=['dashboard','tables','kds','bills'];
      [].forEach.call(nav.querySelectorAll('button'),function(b){
        b.classList.toggle('on',b.dataset.go===v||(b.dataset.go==='more'&&main.indexOf(v)<0));});
      var o=document.getElementById('view-order');
      document.body.classList.toggle('in-order',!!(o&&o.classList.contains('active')));
    }
    new MutationObserver(sync).observe(shell,{attributes:true,subtree:true,attributeFilter:['class']});
    sync();

    /* keyboard: Alt+1…9, Alt+0 jump between tabs (desktop) */
    document.addEventListener('keydown',function(e){
      if(!e.altKey||e.ctrlKey||e.metaKey||/INPUT|TEXTAREA|SELECT/.test((e.target||{}).tagName))return;
      var i=e.key==='0'?9:parseInt(e.key,10)-1;
      if(i>=0&&navBtns[i]){e.preventDefault();navBtns[i].click();}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();

/* Tables tab: live Free / Occupied / Partly taken summary (read-only) */
(function(){
  function init(){
    var grid=document.getElementById('tableGrid'),tabs=document.getElementById('floorTabs');
    if(!grid||!tabs||document.getElementById('tableSummary'))return;
    var box=document.createElement('div');box.id='tableSummary';box.className='table-summary';
    tabs.parentNode.insertBefore(box,tabs);
    function chip(c,l,n){return '<span class="ts-chip '+c+'"><i class="ts-dot"></i><b>'+n+'</b>'+l+'</span>';}
    function update(){
      var all=grid.querySelectorAll('.table-card');
      var f=grid.querySelectorAll('.table-card.tc-free').length,
          b=grid.querySelectorAll('.table-card.tc-full').length,
          p=grid.querySelectorAll('.table-card.tc-partial').length;
      var html=chip('ts-free','Free',f)+chip('ts-busy','Occupied',b)+chip('ts-part','Partly taken',p);
      if(box.dataset.k!==html){box.dataset.k=html;box.innerHTML=html;}
    }
    new MutationObserver(update).observe(grid,{childList:true,subtree:true});
    update();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
/* Settings rail: smooth jump + active-section highlight */
(function(){
  function init(){
    var rail=document.getElementById('settingsRail');
    if(!rail)return;
    var links=[].slice.call(rail.querySelectorAll('a'));
    function setOn(id){links.forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+id);});}
    links.forEach(function(a){
      a.addEventListener('click',function(e){
        var t=document.getElementById(a.getAttribute('href').slice(1));
        if(!t)return;
        e.preventDefault();
        t.scrollIntoView({behavior:'smooth',block:'start'});
        setOn(t.id);
      });
    });
    if(!('IntersectionObserver' in window))return;
    var io=new IntersectionObserver(function(es){
      es.forEach(function(en){if(en.isIntersecting)setOn(en.target.id);});
    },{rootMargin:'-15% 0px -70% 0px'});
    links.forEach(function(a){var t=document.getElementById(a.getAttribute('href').slice(1));if(t)io.observe(t);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();