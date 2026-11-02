// ストップウォッチ(ポモドーロ)の計測の途中で、再読み込み・タブやウィンドウを閉じる・別のページへ移る、をしようとしたときに、
// ブラウザの「このサイトを離れますか? 行った変更が保存されない可能性があります」の確認を出す(うっかり計測を失わないように)。
// ・計測の状態は、メモリの中だけにあり、再読み込みで失われる。
// ・確認の文面は、ブラウザが決める(アプリからは変えられない)。ユーザーがページを操作したあとでないと、ブラウザは確認を出さないが、
//   計測を始めるのは操作なので、問題ない。iPad / iPhone の Safari など、確認を出さないブラウザもある(その場合は、止められない)。
// ・アプリ自身が再読み込みする場面(更新のお知らせの「更新」、バックアップの復元、全データ削除)でも、同じ確認が出る(計測を失うのは同じため)。
//
// installLeaveGuard({ isActive }) → 解除する関数

export function installLeaveGuard({ isActive, win = window }) {
  const handler = (e) => {
    if (!isActive()) return undefined;
    e.preventDefault();
    e.returnValue = "";   // 古いブラウザは、これを設定したときだけ確認を出す
    return "";
  };
  win.addEventListener("beforeunload", handler);
  return () => win.removeEventListener("beforeunload", handler);
}
