/* check_judge.js — 正解判定の総当たり検証
   使い方: node tools/check_judge.js
   全1025種 × 4通りの打ち方（カタカナ／ひらがな／ローマ字／長音を省いたローマ字）で
   「自分に正解になるか」「別の種に誤って正解にならないか」を確かめる。
   図鑑データはコンプリート版の data/dex.json を読む（公開版と中身は完全一致）。
   判定のルールをいじったら必ずこれを通すこと。 */
/* 全1025種 × 4通りの打ち方で総当たり。誤正解が1件も無いことを確かめる */
const fs=require('fs'),vm=require('vm'),path=require('path');
/* 図鑑データは、隣に置いてあるコンプリート版の data/dex.json を借りる。
   公開版はテキストを一切ホストしないので、手元に無ければ第1引数でパスを渡す。 */
const HERE=path.resolve(__dirname,'..');
const ROOT=process.argv[2] ? path.resolve(process.argv[2])
                           : path.resolve(HERE,'..','pokemon_quiz_complete');
const DEXFILE=path.join(ROOT,'data','dex.json');
if(!fs.existsSync(DEXFILE)){
  console.error('図鑑データが見つかりません: '+DEXFILE);
  console.error('使い方: node tools/check_judge.js [コンプリート版のパス]');
  process.exit(2);
}
const DEX=JSON.parse(fs.readFileSync(DEXFILE,'utf8'));
function mk(){const m={};return{getItem:k=>k in m?m[k]:null,setItem:(k,v)=>{m[k]=String(v)},removeItem:k=>{delete m[k]}}}
const ctx={location:{search:'',protocol:'https:',hostname:'localhost'},
 document:{getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]},
 localStorage:mk(),sessionStorage:mk(),console,setTimeout,clearTimeout,
 fetch:()=>Promise.resolve({ok:true,json:()=>Promise.resolve(DEX)}),Promise,Math,JSON,Date,
 Image:function(){},caches:undefined};
ctx.window=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT,'js/localdex.js'),'utf8'),ctx,{filename:'localdex.js'});
/* localdex.js はコンプリート版にしかないので、そこだけ ROOT 側から読む */
for(const f of ['js/state.js','js/dexdata.js','js/judge.js'])
  vm.runInContext(fs.readFileSync(path.join(HERE,f),'utf8'),ctx,{filename:f});

const hira=s=>s.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));

ctx.loadDex().then(()=>{
  const names=[];
  for(let id=1;id<=ctx.MAX_DEX_ID;id++){const sp=ctx.speciesOf(id);if(sp&&sp.nameJa)names.push(sp.nameJa)}
  const norm=n=>ctx.applyAlias(ctx.normalizeAnswer(n));

  // 各ポケモンについて「こう打つだろう」という入力を4通り作る
  /* 長音を省いた形が2種以上に当たる名前（オオタチ / パーモット など）は、
     省略形で打っても正解にしない仕様。テストの入力からも外す。 */
  const counts=ctx.looseCount();
  const variants=names.map(n=>{
    const v=[n, hira(n), ctx.romajiKey(norm(n))];
    const loose=ctx.romajiKeyLoose(norm(n));
    if(!(counts&&counts[loose]>1)) v.push(loose);
    return {n,v};
  });
  const ambiguous=names.filter(n=>{const k=ctx.romajiKeyLoose(norm(n));return counts&&counts[k]>1});
  console.log('長音の省略を認めない名前: '+ambiguous.length+' 件 → '+ambiguous.join('・')+'\n');

  let selfNg=0, crossNg=0, crossShown=0;
  // 鍵ごとに索引を作って総当たりのコストを下げる
  const byNorm={}, byStrict={}, byLoose={};
  names.forEach(n=>{const k=norm(n);
    (byNorm[k]=byNorm[k]||[]).push(n);
    (byStrict[ctx.romajiKey(k)]=byStrict[ctx.romajiKey(k)]||[]).push(n);
    (byLoose[ctx.romajiKeyLoose(k)]=byLoose[ctx.romajiKeyLoose(k)]||[]).push(n);
  });

  variants.forEach(({n,v})=>{
    v.forEach(inp=>{
      // 1) 自分には必ず正解になること
      if(!ctx.judgeAnswer(inp,n)){selfNg++;if(selfNg<=10)console.log('  ✘ 自分に不正解: '+n+' ← 「'+inp+'」')}
      // 2) 同じ鍵を持つ他の種にだけ当たりうるので、そこだけ確かめる
      const cands=new Set([...(byNorm[norm(inp)]||[]),
        ...(byStrict[ctx.romajiKey(norm(inp))]||[]),
        ...(byLoose[ctx.romajiKeyLoose(norm(inp))]||[])]);
      cands.forEach(other=>{
        if(other===n) return;
        if(ctx.judgeAnswer(inp,other)){crossNg++;
          if(crossShown++<10)console.log('  ✘ 誤正解: 「'+inp+'」('+n+') が '+other+' の正解になる')}
      });
    });
  });

  console.log('総当たり: '+names.length+' 種 × 4通り = '+(names.length*4)+' 入力');
  console.log('  自分に不正解: '+selfNg+' 件');
  console.log('  別種に誤正解: '+crossNg+' 件');

  console.log('\n[自己テスト（Dex あり）]');
  const pass=ctx.judgeSelfTest();
  const ok=(selfNg===0&&crossNg===0&&pass);
  console.log('\n'+(ok?'✅ すべて通過':'❌ NG'));
  process.exit(ok?0:1);
}).catch(e=>{console.error(e);process.exit(2)});
