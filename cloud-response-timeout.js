// Garante que a leitura da resposta da Edge Function também tenha limite de tempo.
(function(){
  const originalFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const response=await originalFetch(input,init);
    const url=typeof input==='string'?input:(input&&input.url)||'';
    if(!url.includes('/functions/v1/wanted-list-secure'))return response;
    const originalText=response.text.bind(response);
    return new Proxy(response,{
      get(target,property){
        if(property==='text')return function(){
          return Promise.race([
            originalText(),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('TEMPO_ESGOTADO: o Supabase demorou para concluir a resposta.')),15000))
          ]);
        };
        const value=Reflect.get(target,property,target);
        return typeof value==='function'?value.bind(target):value;
      }
    });
  };
})();
