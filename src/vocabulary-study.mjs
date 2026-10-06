import { studyEntries, uniqueMatchingEntries, normalizeStudyAnswer, shuffled } from './core/vocabulary.mjs';
import { t } from './i18n.mjs';
const $=id=>document.getElementById(id);
const make=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(cls)node.className=cls;return node;};
const content=(tag,text,cls)=>{const node=make(tag,text,cls);node.dataset.userContent='true';return node;};
export class VocabularyStudy {
  constructor({desktop,onSaved}) {
    this.desktop=desktop;this.onSaved=onSaved;this.session=0;
    $('vocabulary-study-close').onclick=()=>$('vocabulary-study-dialog').close();
    $('vocabulary-study-dialog').addEventListener('close',()=>{this.session++;});
    $('vocabulary-study-mode').onchange=()=>this.start(this.folderId,this.folderName,this.original,$('vocabulary-study-mode').value,false);
    $('vocabulary-study-restart').onclick=()=>this.start(this.folderId,this.folderName,this.original,this.mode,false);
  }
  start(folderId,name,entries,mode,open=true) {
    this.session++;this.folderId=folderId;this.folderName=name;this.original=entries;this.mode=mode;this.index=0;this.answers=[];this.checked=false;this.revealed=false;this.finished=false;
    this.items=shuffled(mode==='matching'?uniqueMatchingEntries(entries).slice(0,2000):studyEntries(entries).slice(0,2000));
    $('vocabulary-study-folder').textContent=name;$('vocabulary-study-folder').dataset.userContent='true';$('vocabulary-study-mode').value=mode;
    $('vocabulary-study-error').textContent='';$('vocabulary-study-result').textContent='';
    const missing=entries.length-studyEntries(entries).length;
    $('vocabulary-study-note').textContent=missing?t('{count} từ chưa có nghĩa được bỏ qua. Bạn có thể bổ sung nghĩa trong danh sách vocab.',{count:missing}):t('Bài học chỉ dùng từ trong thư mục này.');
    if(open&&!$('vocabulary-study-dialog').open)$('vocabulary-study-dialog').showModal();
    this.render();
  }
  progress() {$('vocabulary-study-progress').max=Math.max(1,this.items.length);$('vocabulary-study-progress').value=this.finished?this.items.length:this.mode==='matching'?this.answers.length:this.index;$('vocabulary-study-counter').textContent=`${this.finished?this.items.length:this.mode==='matching'?this.answers.length:this.index} / ${this.items.length}`;}
  render() {
    const body=$('vocabulary-study-body');body.replaceChildren();this.progress();
    if(!this.items.length||(this.mode==='matching'&&this.items.length<2)){body.append(make('p',t(this.mode==='matching'?'Cần ít nhất hai từ có nghĩa khác nhau để nối từ.':'Thư mục này chưa có từ kèm nghĩa để học.'),'empty-note'));return;}
    if(this.mode==='matching'){this.renderMatching(body);return;}
    const entry=this.items[this.index];
    if(this.mode==='flashcards'){
      const card=make('button',null,'study-flashcard');card.type='button';card.setAttribute('aria-label',t('Lật flashcard'));
      card.append(make('small',t(this.revealed?'NGHĨA':'TỪ')),content('div',this.revealed?entry.translation:entry.text,'study-card-text'));
      card.onclick=()=>{this.revealed=!this.revealed;this.render();};body.append(card);
      const flip=make('button',t(this.revealed?'Xem từ':'Hiện nghĩa'),'secondary');flip.id='study-flip';flip.onclick=()=>{this.revealed=!this.revealed;this.render();};body.append(flip);
      const actions=make('div',null,'study-answer-actions');
      for(const correct of [false,true]){const button=make('button',t(correct?'Đã nhớ':'Chưa nhớ'),correct?'primary':'secondary');button.id=correct?'study-known':'study-again';button.disabled=!this.revealed;button.onclick=()=>this.advance(correct);actions.append(button);}body.append(actions);
    }else{
      body.append(make('p',t('Nhìn nghĩa, viết từ tương ứng.'),'study-prompt-label'),content('div',entry.translation,'study-prompt'));
      const form=make('form'),label=make('label',t('Đáp án của bạn'),'field'),input=make('textarea');input.id='study-typing-answer';input.rows=2;input.maxLength=12000;input.autocomplete='off';input.spellcheck=false;input.required=true;input.disabled=this.checked;
      label.append(input);form.append(label);const submit=make('button',t(this.checked?'Từ tiếp theo':'Kiểm tra'),'primary');submit.id='study-typing-check';submit.type=this.checked?'button':'submit';
      if(this.checked){body.append(make('p',t(this.lastCorrect?'Chính xác!':'Chưa đúng. Đáp án đúng:'),this.lastCorrect?'study-correct':'study-wrong'));if(!this.lastCorrect)body.append(content('div',entry.text,'study-answer'));submit.onclick=()=>this.advance(this.lastCorrect);}
      form.onsubmit=event=>{event.preventDefault();this.lastCorrect=normalizeStudyAnswer(input.value)===normalizeStudyAnswer(entry.text);this.checked=true;this.typed=input.value;this.render();};form.append(submit);body.append(form);
      if(this.checked){input.value=this.typed;input.required=false;}else input.focus();
    }
  }
  advance(correct) {
    this.answers.push({id:this.items[this.index].id,correct});this.index++;this.checked=false;this.revealed=false;
    if(this.index===this.items.length)this.finish();else this.render();
  }
  renderMatching(body) {
    const round=this.items.slice(this.answers.length,this.answers.length+6);
    this.selectedWord=null;this.selectedMeaning=null;this.matched=new Set();this.missed=new Set();
    body.append(make('p',t('Chọn một từ ở trái rồi chọn nghĩa tương ứng ở phải.'),'study-prompt-label'));
    const columns=make('div',null,'study-matching'),left=make('div'),right=make('div');this.wordButtons=new Map();this.meaningButtons=new Map();
    const pick=()=>{
      if(!this.selectedWord||!this.selectedMeaning)return;
      const word=this.items.find(entry=>entry.id===this.selectedWord),meaning=this.items.find(entry=>entry.id===this.selectedMeaning);
      const good=normalizeStudyAnswer(word.translation)===normalizeStudyAnswer(meaning.translation);
      if(good){this.matched.add(word.id);this.answers.push({id:word.id,correct:!this.missed.has(word.id)});this.wordButtons.get(word.id).disabled=true;this.meaningButtons.get(meaning.id).disabled=true;$('vocabulary-study-result').textContent=t('Đúng cặp!');}
      else{this.missed.add(word.id);$('vocabulary-study-result').textContent=t('Chưa đúng, hãy thử lại.');}
      for(const button of [...this.wordButtons.values(),...this.meaningButtons.values()])button.classList.remove('selected');
      this.selectedWord=this.selectedMeaning=null;this.progress();
      if(this.matched.size===round.length){if(this.answers.length===this.items.length)this.finish();else{ $('vocabulary-study-result').textContent='';this.render(); }}
    };
    for(const entry of round){const button=content('button',entry.text,'study-match-word');button.dataset.entryId=entry.id;button.onclick=()=>{for(const node of this.wordButtons.values())node.classList.remove('selected');button.classList.add('selected');this.selectedWord=entry.id;pick();};this.wordButtons.set(entry.id,button);left.append(button);}
    for(const entry of shuffled(round)){const button=content('button',entry.translation,'study-match-meaning');button.dataset.entryId=entry.id;button.onclick=()=>{for(const node of this.meaningButtons.values())node.classList.remove('selected');button.classList.add('selected');this.selectedMeaning=entry.id;pick();};this.meaningButtons.set(entry.id,button);right.append(button);}
    columns.append(left,right);body.append(columns);
  }
  async finish() {
    this.finished=true;this.progress();const body=$('vocabulary-study-body');body.replaceChildren();const count=this.answers.filter(answer=>answer.correct).length;
    body.append(make('h3',t('Hoàn thành: {correct}/{total} đúng',{correct:count,total:this.answers.length}),'study-score'));
    const wrong=this.answers.filter(answer=>!answer.correct).map(answer=>this.items.find(entry=>entry.id===answer.id));
    if(wrong.length){body.append(make('p',t('Các từ cần ôn lại:')));for(const entry of wrong)body.append(content('p',entry.text+' — '+entry.translation,'study-review-word'));}
    const session=this.session;
    try{await this.desktop.recordVocabularyStudy({folderId:this.folderId,mode:this.mode,answers:this.answers});await this.onSaved();}
    catch(error){if(session===this.session)$('vocabulary-study-error').textContent=t('Không lưu được kết quả bài học.');}
  }
}
