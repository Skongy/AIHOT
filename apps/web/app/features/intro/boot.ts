/** Runs in the document head before the home page can paint. */
export const INTRO_STORAGE_KEY = "gamehot-intro-seen-v1";
export const INTRO_BOOT_STYLE = 'html[data-intro-pending]::before{content:"";position:fixed;inset:0;z-index:81;background:#131414}';
export const INTRO_BOOT_SCRIPT = `(function(){
  if(location.pathname!=="/")return;
  var force=new URLSearchParams(location.search).get("intro")==="1",seen=false;
  try{seen=sessionStorage.getItem(${JSON.stringify(INTRO_STORAGE_KEY)})==="1"}catch(e){}
  if(seen&&!force)return;
  var root=document.documentElement;
  root.setAttribute("data-intro-pending","");
  setTimeout(function(){root.removeAttribute("data-intro-pending")},8000);
})();`;
