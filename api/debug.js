/**
 * api/debug.js — Diagnóstico completo de todas las fuentes de datos
 * GET https://cot-tracker.vercel.app/api/debug
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Content-Type','application/json');
  const now=new Date(), day=now.getUTCDay()||7;
  const mon=new Date(now); mon.setUTCDate(now.getUTCDate()-day+1); mon.setUTCHours(0,0,0,0);
  const sun=new Date(mon); sun.setUTCDate(mon.getUTCDate()+6);
  const from=mon.toISOString().slice(0,10), to=sun.toISOString().slice(0,10);
  const results={ts:now.toISOString(),week:{from,to},sources:{}};

  // FF
  try{
    const r=await fetch(`https://nfs.faireconomy.media/ff_calendar_thisweek.json?t=${Date.now()}`,{headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0','Referer':'https://www.forexfactory.com/','Cache-Control':'no-cache'},signal:AbortSignal.timeout(8000)});
    const raw=r.ok?await r.json():[];
    const evs=Array.isArray(raw)?raw:[];
    const past=evs.filter(e=>new Date(e.date).getTime()<Date.now());
    const wa=past.filter(e=>{const v=e.actual??e.actualValue;return v!==null&&v!==undefined&&String(v).trim()!==''&&String(v)!=='null';});
    results.sources.ff={ok:r.ok,status:r.status,total:evs.length,past:past.length,withActual:wa.length,withoutActual:past.length-wa.length,sample_keys:evs[0]?Object.keys(evs[0]):[],sample_with_actual:wa.slice(0,3).map(e=>({title:e.title,actual:e.actual,country:e.country,date:e.date}))};
  }catch(e){results.sources.ff={ok:false,error:e.message};}

  // Alpha Vantage
  const avKey=process.env.ALPHAVANTAGE_KEY;
  if(!avKey){
    results.sources.alpha_vantage={ok:false,error:'ALPHAVANTAGE_KEY no configurada — ACCIÓN REQUERIDA: obtener key gratuita en https://www.alphavantage.co/support/#api-key y añadir en Vercel'};
  }else{
    try{
      const url=`https://www.alphavantage.co/query?function=ECONOMIC_CALENDAR&interval=3month&apikey=${avKey}`;
      const r=await fetch(url,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(8000)});
      const raw=r.ok?await r.json():{};
      if(raw?.Information){results.sources.alpha_vantage={ok:false,error:'RATE LIMIT: '+raw.Information};}
      else{
        const arr=raw?.data||(Array.isArray(raw)?raw:[]);
        const wa=arr.filter(e=>{const v=e.actual;return v!==null&&v!==undefined&&String(v).trim()!==''&&String(v)!=='null';});
        const today=now.toISOString().slice(0,10);
        const todayEvs=arr.filter(e=>(e.date||'').slice(0,10)===today);
        const todayWA=todayEvs.filter(e=>norm_debug(e.actual));
        results.sources.alpha_vantage={ok:r.ok,status:r.status,key_used:avKey.slice(0,6)+'***',total:arr.length,withActual:wa.length,today_events:todayEvs.length,today_with_actual:todayWA.length,sample_today:todayEvs.slice(0,5).map(e=>({name:e.name,country:e.country,date:e.date,actual:e.actual,estimate:e.estimate})),sample_with_actual:wa.slice(0,5).map(e=>({name:e.name,country:e.country,date:e.date,actual:e.actual}))};
      }
    }catch(e){results.sources.alpha_vantage={ok:false,error:e.message};}
  }

  // FXStreet
  try{
    const url=`https://calendar.fxstreet.com/EventDateProvider/GetEventsByDate?dateFrom=${from}T00:00:00Z&dateTo=${to}T23:59:59Z&timezone=UTC`;
    const r=await fetch(url,{headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0','Referer':'https://www.fxstreet.com/economic-calendar','Origin':'https://www.fxstreet.com'},signal:AbortSignal.timeout(5000)});
    const raw=r.ok?await r.json():null;
    const arr=Array.isArray(raw)?raw:(raw?.events||raw?.data||[]);
    const wa=arr.filter(e=>norm_debug(e.Actual??e.actual));
    results.sources.fxstreet={ok:r.ok,status:r.status,total:arr.length,withActual:wa.length,sample:arr.slice(0,3).map(e=>({Name:e.Name||e.name,Actual:e.Actual??e.actual,Country:e.CountryCode||e.country}))};
  }catch(e){results.sources.fxstreet={ok:false,error:e.message};}

  // FMP
  const fmpKey=process.env.FMP_KEY;
  if(fmpKey){
    try{
      const r=await fetch(`https://financialmodelingprep.com/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${fmpKey}`,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(7000)});
      const raw=r.ok?await r.json():[];
      const arr=Array.isArray(raw)?raw:[];
      const wa=arr.filter(e=>norm_debug(e.actual));
      results.sources.fmp={ok:r.ok,status:r.status,note:r.status===403?'403=endpoint no disponible en plan free (requiere Starter $29/mes)':'',total:arr.length,withActual:wa.length};
    }catch(e){results.sources.fmp={ok:false,error:e.message};}
  }

  // Diagnóstico
  const av=results.sources.alpha_vantage;
  results.diagnosis={
    ff_has_actuals:(results.sources.ff?.withActual||0)>0,
    av_configured:!!avKey,
    av_working:av?.ok===true,
    av_has_actuals:(av?.withActual||0)>0,
    fxs_working:results.sources.fxstreet?.ok===true,
    fxs_has_actuals:(results.sources.fxstreet?.withActual||0)>0,
    action_needed:!avKey?'CRÍTICO: Configurar ALPHAVANTAGE_KEY en Vercel (gratis en https://www.alphavantage.co/support/#api-key)':av?.ok&&(av?.withActual||0)>0?'✅ Alpha Vantage funciona y tiene actuals':'⚠️ Alpha Vantage configurado pero sin actuals para esta semana',
  };
  return res.status(200).json(results);
}
function norm_debug(v){if(v===undefined||v===null)return false;const s=String(v).trim();return s!==''&&s!=='null'&&s!=='N/A'&&s!=='-';}
