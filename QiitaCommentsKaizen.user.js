// ==UserScript==
// @name         Qiita Comments Kaizen
// @namespace    https://github.com/querykuma/
// @version      1.0.0
// @description  Qiitaの記事にコメント番号と各種コメント数と冒頭のコメント情報と作者のコメントを示す印を追加。@userのホバー時に返信先のコメントをポップアップ、目次にコメントを追加。
// @author       Query Kuma
// @match        https://qiita.com/*/items/*
// @grant        none
// ==/UserScript==

(function () {
	'use strict';

	var g_debug = 0;

	var positive_comment_regexps = [
		/(素晴|すば)らしい/u,
		/(有り?難|ありがと)う/u,
		/(有り?難|ありがた)い/u,
		/(お|御)礼/u,
		/感謝(です|します)/u,
		/勉強になりま(した|す)/u,
		/(わか|分か|解|判)り(やす|易)かった/u,
		/参考になりま(した|す)/u,
		/(良い?|とてもよい|^いい)記事/um,
		/好評/u,
		/(?<!(方|ほう)が)(良|い)いですね/u,
		/助かりま/u,
		/素敵(な|です)/u,
		/(すご|凄)いです/u
	];

	/** 自身によるDOM操作をMutationObserverに無視するように伝えるグローバルフラグ */
	var g_ignore_mutation = false;

	console.log("Qiita Comments Kaizen");

	/**
	 * HTMLの文字列をエスケープする
	 * @param {string} s_text
	 * @returns {string}
	 */
	var escape_html = (s_text) => {
		const replace_table = {
			'&': '&amp;',
			"'": '&#x27;',
			'`': '&#x60;',
			'"': '&quot;',
			'<': '&lt;',
			'>': '&gt;'
		};

		return s_text.replace(/[&'`"<>]/gu, (m) => replace_table[m]);
	};

	/**
	 * 追加されていなければスタイルシートを追加する。
	 * @returns
	 */
	var add_style_sheet = () => {
		if (document.getElementById('qiita_comments_kaizen__style')) {
			return;
		}

		document.head.insertAdjacentHTML('beforeend', `
<style id="qiita_comments_kaizen__style">
.qiita_comments_kaizen__comment_number{margin-bottom: 10px; cursor: pointer; position: relative;}
.qiita_comments_kaizen__sub_comment_number{margin-left: 5px;}
#comments .fa-link{color: #999; padding: 0 8px 0 0; display: none; font-size: 2rem;}
#comments .qiita_comments_kaizen__comment_number:hover .fa-link{display: block; position: absolute; left: -2rem; top: 0.3rem;}
#comments .qiita_comments_kaizen__author_section {border-left: 3px #55c500 solid;}
#QiitaCommentsKaizen_mouseover {position: absolute; margin: 1rem; background-color: #fafafa; z-index: 9999; box-shadow: #232323 0px 0px 15px; overflow: auto; }
</style>`);
	};

	/**
	 * 前向きなコメントならtrueを返す。
	 * @param {element} e_comment
	 * @returns boolean
	 */
	var is_positive_comment = (e_comment) => {
		var e_text = e_comment.querySelector(':scope>div:nth-of-type(2)');
		if (!e_text) {
			// サービス利用規約に基づき、このコメントは削除されました。
			return false;
		}

		var text = e_text.textContent;

		for (let index = 0; index < positive_comment_regexps.length; index++) {
			const positive_comment_regexp = positive_comment_regexps[index];
			var m = text.match(positive_comment_regexp);
			if (m) {
				if (g_debug > 2) {
					console.log("positive_comment:", m[0]);
				}

				return true;
			}
		}
		return false;
	};

	/**
	 * 削除されたコメントならtrueを返す。
	 * @param {element} e_comment
	 * @returns
	 */
	var is_deleted_comment = (e_comment) => e_comment.querySelector('div').textContent === "サービス利用規約に基づき、このコメントは削除されました。";

	/**
	 * 記事の作成者の名前を返す。
	 * @returns string
	 */
	var get_article_author = () => {
		var m = document.URL.match(/^https:\/\/qiita\.com\/(.*?)\//u);
		var user_id = m[1];
		return user_id;
	};

	/**
	 * 最初にすべてのコメントを一回見て、できること（引数オブジェクトの更新、コメント番号を振る）をする。
	 * @param {HTMLElement[]} e_comments
	 * @param {{ count: number, href_id: string }} o_positive_comment
	 * @param {Object.<string, { n_total: number, index: number }>} o_user_comments_number
	 */
	var look_through_comments = (e_comments, o_positive_comment, o_user_comments_number) => {
		for (let index = 0; index < e_comments.length; index++) {
			const e_comment = e_comments[index];

			e_comment.dataset.qiita_comments_kaizen__number = index + 1;

			if (is_positive_comment(e_comment)) {
				o_positive_comment.count++;

				if (!o_positive_comment.href_id) {
					o_positive_comment.href_id = e_comment.getAttribute('id');
				}
			}

			var e_commenter = e_comment.querySelector(":scope>div:first-of-type a:last-of-type");
			var s_commenter = e_commenter.textContent;

			e_commenter.classList.add('qiita_comments_kaizen__commenter');

			if (Object.prototype.hasOwnProperty.call(o_user_comments_number, s_commenter)) {
				o_user_comments_number[s_commenter].n_total++;
			} else {
				o_user_comments_number[s_commenter] = {
					"n_total": 1,
					"index": 1
				};
			}
		}
	};

	/**
	 * コメント番号を振る。
	 * @param {HTMLElement[]} e_comments
	 * @param {Object.<string, { n_total: number, index: number }>} o_user_comments_number
	 */
	var add_comment_numbers = (e_comments, o_user_comments_number) => {
		for (let index = 0; index < e_comments.length; index++) {
			const e_comment = e_comments[index];

			var e_commenter = e_comment.querySelector(":scope>div:first-of-type a:last-of-type");
			var s_commenter = e_commenter.textContent;

			var o_commenter = o_user_comments_number[s_commenter];

			if (o_commenter.n_total > 1) {
				if (!e_comment.querySelector('.qiita_comments_kaizen__sub_comment_number')) {
					e_commenter.insertAdjacentHTML('afterend', `<span class="qiita_comments_kaizen__sub_comment_number">(${o_commenter.index} / ${o_commenter.n_total})</span>`);
				}

				o_commenter.index++;
			}

			if (!e_comment.querySelector('.qiita_comments_kaizen__comment_number')) {
				e_comment.insertAdjacentHTML('afterbegin', `<div class="qiita_comments_kaizen__comment_number"><a href="#${e_comment.id}"><i class="fa fa-link"></i></a>コメント ${index + 1} / ${e_comments.length}</div>`);
			}
		}
	};

	/**
	 * 作者のコメントに'（作者）'の印を付ける。
	 * @param {HTMLElement[]} e_comments
	 * @param {string} s_author
	 */
	var mark_author_comments = (e_comments, s_author) => {
		for (let index = 0; index < e_comments.length; index++) {
			const e_comment = e_comments[index];

			var e_authors = e_comment.querySelectorAll(`a[href="/${s_author}"]:last-of-type`);
			for (let index = 0; index < e_authors.length; index++) {
				const e_author = e_authors[index];

				if (e_author.classList.contains('qiita_comments_kaizen__author_text')) {
					continue;
				}

				e_author.classList.add('qiita_comments_kaizen__author_text');
				e_author.append('（作者）');
			}

			var e_author_header = e_comment.querySelector(':scope>div:not(.qiita_comments_kaizen__comment_number)')?.querySelector(`a[href="/${s_author}"]:last-of-type`);
			if (e_author_header) {
				e_comment.classList.add('qiita_comments_kaizen__author_section');
			}
		}
	};

	/**
	 * コメント投稿者ごとのコメント数を返す。
	 * @param {HTMLElement[]} e_comments
	 * @param {string} s_author
	 * @returns {string}
	 */
	var get_summary = (e_comments, s_author) => {
		var o_summary = {};

		for (let index = 0; index < e_comments.length; index++) {
			const e_comment = e_comments[index];
			let e_commenter = e_comment.querySelector(':scope>div:not(.qiita_comments_kaizen__comment_number) a')?.href.match(/^.*\/(.*)$/u)[1];

			if (!e_commenter) {
				continue;
			}

			if (e_commenter === s_author) {
				e_commenter += '（作者）';
			}

			o_summary[e_commenter] = (o_summary[e_commenter] ?? 0) + 1;
		}

		return Object.entries(o_summary).sort((a, b) => b[1] - a[1]).
			map((a) => `${a[1]}: ${a[0]}`).
			join('\n');
	};

	/**
	 * コメントヘッダを更新する。
	 * @param {HTMLElement[]} e_comments
	 * @param {{ count: number, href_id: string }} o_positive_comment
	 * @param {string} s_author
	 * @returns
	 */
	var update_comment_header = (e_comments, o_positive_comment, s_author) => {
		var text;

		var header = document.querySelector('h1');
		if (!header) {
			console.log("h1 not found");
			return;
		}

		var e_author_comments = document.querySelectorAll("#comments .qiita_comments_kaizen__author_text");

		var e_header = document.querySelector('#qiita_comments_kaizen__header');

		if (e_header) {
			if (g_debug > 1) {
				console.log("e_header.remove()");
			}

			e_header.remove();
		}

		if (document.querySelector('#comments>div').textContent === 'コメントを読み込んでいます。') {
			if (g_debug > 1) {
				console.log("コメントを読み込んでいます");
			}

			text = `<div id="qiita_comments_kaizen__header"><a href="#comments">コメント</a>を読み込んでいます。</div>`;

			header.insertAdjacentHTML('afterend', text);
			return;
		}

		var e_author_comment = document.querySelector('.qiita_comments_kaizen__author_text');
		var author_href_id = null;
		if (e_author_comment) {
			author_href_id = e_author_comment.closest('[id]');
			if (author_href_id) {
				author_href_id = author_href_id.getAttribute('id');
			}
		}

		var d_bracket_texts = [];

		if (author_href_id) {
			d_bracket_texts.push(`<a href="#${author_href_id}">作者</a>：<span>${e_author_comments.length}</span>`);
		}

		if (o_positive_comment.count) {
			d_bracket_texts.push(`<a href="#${o_positive_comment.href_id}">前向き</a>：<span>${o_positive_comment.count}</span>`);
		}

		var s_bracket_text = d_bracket_texts.length ? `（${d_bracket_texts.join('、')}）` : '';

		text = `<div id="qiita_comments_kaizen__header" title="${escape_html(get_summary(e_comments, s_author))}"><a href="#comments">コメント</a>数は <span>${e_comments.length}</span>${s_bracket_text}です</div>`;

		header.insertAdjacentHTML('afterend', text);
	};

	/**
	 * 目次(TOC)にコメントを追加する。
	 * @param {HTMLElement[]} e_comments
	 * @returns
	 */
	var add_toc = (e_comments) => {
		if (!e_comments.length) {
			return;
		}

		if (document.querySelector('#QiitaCommentsKaizen_toc')) {
			return;
		}

		var e_ul = document.querySelector('.p-items_toc div>ul');
		if (e_ul) {
			e_ul = e_ul.parentElement;
		} else {
			e_ul = document.querySelector('.p-items_toc');
			if (!e_ul) {
				return;
			}
		}

		var t_html = '<ul id="QiitaCommentsKaizen_toc"><li><a href="#comments">コメント</a>\n</li></ul>';
		e_ul.insertAdjacentHTML('beforeend', t_html);
	};

	/**
	 * コメントの読み込みが完了した可能性のあるときに呼び出される関数。
	 */
	var commentContentMightLoaded = () => {
		if (g_debug) {
			console.log('commentContentMightLoaded, number of comments:', document.querySelectorAll("#comments>section[id^='comment']").length);
		}

		add_style_sheet();

		if (g_debug > 1) {
			console.log('commentContentMightLoaded: set f_ignore_mutation = true');
		}

		g_ignore_mutation = true;

		var s_author = get_article_author();

		var e_comments = document.querySelectorAll('#comments>section');
		e_comments = [...e_comments].filter((a) => !is_deleted_comment(a));

		/** @type {{ count: number, href_id: string }} */
		var o_positive_comment = {
			"count": 0,
			"href_id": null
		};

		/** コメント投稿者の名前からコメントオブジェクト{コメント投稿者の総コメント数,index}へのオブジェクト */
		/** @type {Object.<string, { n_total: number, index: number }>} */
		var o_user_comments_number = {};

		look_through_comments(e_comments, o_positive_comment, o_user_comments_number);

		add_comment_numbers(e_comments, o_user_comments_number);

		mark_author_comments(e_comments, s_author);

		update_comment_header(e_comments, o_positive_comment, s_author);

		add_toc(e_comments);

		setTimeout(() => {
			if (g_debug > 1) {
				console.log('setTimeout: set f_ignore_mutation = false');
			}

			g_ignore_mutation = false;
		}, 0);
	};

	/**
	 * intervalの間、mutationsが発生しなかったらcallbackを実行する。
	 * @param {function} callback
	 * @param {number} interval
	 * @returns
	 */
	var add_callback_mutations_end = (callback, interval) => {
		/** @type {MutationObserver} */
		var observer;
		var n_mutation_timeout = null;

		const config = {
			"attributes": false,
			"characterData": true,
			"childList": true,
			"subtree": true
		};

		/**
		 * MutationObserverのコールバック。
		 * @param {MutationRecord[]} mutations
		 * @returns
		 */
		var mutation_callback = (mutations) => {
			if (g_ignore_mutation) {
				if (g_debug > 1) {
					console.log('mutations while f_ignore_mutation is true:', mutations);
				}

				return;
			}

			clearTimeout(n_mutation_timeout);
			n_mutation_timeout = setTimeout(() => {
				// コメント数が1以上ならMutationObserverを終了させる。
				if (document.querySelectorAll("#comments>section[id^='comment']").length) {
					if (g_debug > 1) {
						console.log('MutationObserver disconnect()');
					}

					observer.disconnect();
				}

				callback();
			}, interval);
		};

		observer = new MutationObserver(mutation_callback);
		observer.observe(document, config);
		mutation_callback();

		return observer;
	};

	add_callback_mutations_end(commentContentMightLoaded, 1000);

	/**
	 * f_use_mentionがtrueのとき
	 * 返信先(@user)をmouseover時に表示するe_div（返信先のコメント）を作成して返す。
	 * f_use_mentionがfalseのとき（＝呼び出し元関数でf_commenterがtrueのとき）
	 * コメント投稿者（@user）をmouseover時に表示するe_div（コメント投稿者の全コメント）を作成して返す。
	 * @param {element} e_target
	 * @param {boolean} f_use_mention
	 * @param {number} n_section_base
	 * @returns {element}
	 */
	var create_mouseover_div = (e_target, f_use_mention, n_section_base) => {
		var n_index_upper_bound;
		var s_user_href = e_target.href;

		var e_div = document.createElement('div');
		var e_sections = document.querySelectorAll('#comments > section[data-qiita_comments_kaizen__number]');

		if (f_use_mention) {
			n_index_upper_bound = n_section_base - 1;
		} else {
			n_index_upper_bound = e_sections.length;
		}

		for (let index = 0; index < n_index_upper_bound; index++) {
			const e_section = e_sections[index];

			var e_a = e_section.querySelector('a[href^="/"]');

			if (!e_a) {
				continue;
			} else if (e_a.href === s_user_href) {
				// コメントの投稿者のhrefがs_user_hrefに一致するならcloneしてe_divに追加する。
				const e_clone = e_section.cloneNode(true);

				e_clone.querySelectorAll('.qiita_comments_kaizen__comment_number').forEach((a) => a.remove());

				// 後で展開されて位置がずれるので置換する。
				e_clone.querySelectorAll('qiita-embed-ogp').forEach((a) => a.replaceWith((a.src)));

				// 最後のLGTM行を削除する。
				e_clone.querySelectorAll('section>div:last-of-type').forEach((a) => a.remove());

				e_div.append(e_clone);
			}
		}

		return e_div;
	};

	/**
	 * mouseoverした要素が@userの要素（返信先かコメント投稿者）なら、どちらかに応じて
	 * @userのコメント一覧をcloneしてe_divに追加し、マウスカーソルの右上の辺りにe_divを表示する。
	 */
	var c_mouseover = (() => {
		var o_timeout_id = null;

		/**
		 * @param {MouseEvent} e
		 */
		return (e) => {
			var e_target = e.target;

			// 返信先の@userをmouseoverしたかのフラグ
			var f_use_mention = e_target.classList.contains('user-mention');

			// コメント投稿者の@userをmouseoverしたかのフラグ
			var f_commenter = e_target.classList.contains('qiita_comments_kaizen__commenter');

			// ポップアップの中でmouseoverしたかのフラグ
			var f_inside_mouseover = Boolean(e_target.closest('#QiitaCommentsKaizen_mouseover'));

			// ポップアップの中でmouseoverしたときはコメント投稿者の@userのmouseoverに反応しない。
			if (f_use_mention || (f_commenter && !f_inside_mouseover)) {
				var n_section_base = Number(e_target.closest('section').dataset.qiita_comments_kaizen__number);

				var e_div = create_mouseover_div(e_target, f_use_mention, n_section_base);

				// 参照先のコメントがない場合と
				// コメント投稿者の@userをmouseoverしてコメント数が1つの場合に
				// ポップアップを表示しない。
				if (!e_div.childElementCount
					|| (f_commenter && e_div.childElementCount === 1)) {
					return;
				}

				clearTimeout(o_timeout_id);

				var px_per_rem = parseFloat(getComputedStyle(document.documentElement).fontSize);

				document.querySelector('#QiitaCommentsKaizen_mouseover')?.remove();

				e_div.id = 'QiitaCommentsKaizen_mouseover';


				/**
				 * 最初にrightとbottomを指定してwidthとheightを求める。
				 */

				// ページのの右端をe_divのrightにする。
				e_div.style.right = '0px';

				// e_targetの上辺をe_divのbottomにする。
				e_div.style.bottom = `${document.documentElement.clientHeight - e.pageY}px`;


				document.body.append(e_div);

				var bcr_div = e_div.getBoundingClientRect();

				var n_max_width = (document.documentElement.clientWidth / 2).toFixed();
				var n_max_height = (document.documentElement.clientHeight * 2 / 3).toFixed();

				if (bcr_div.left < e.clientX) {
					// e_divの左辺がマウス座標より左のとき

					// 2 * px_per_remはe_divの左右のmargin合計(2rem)のピクセル数
					e_div.style.width = `${Math.max(n_max_width, document.documentElement.clientWidth - e.clientX - 2 * px_per_rem)}px`;
				} else {
					// e_divの左辺がマウス座標より右のとき

					e_div.style.right = '';
					e_div.style.left = `${e.pageX}px`;
				}

				bcr_div = e_div.getBoundingClientRect();

				if (bcr_div.top < 0) {
					// ビューポートの上辺をe_divのtopにする。
					e_div.style.top = `${document.documentElement.scrollTop}px`;
					e_div.style.bottom = '';

					e_div.style.maxHeight = `${Math.max(e.clientY - 2 * px_per_rem - 10, n_max_height)}px`;
				}

				e_div.scrollTo(0, e_div.scrollHeight);

				var e_div_destination;
				if (f_commenter) {
					e_div_destination = e_div.querySelector(`:scope>section[data-qiita_comments_kaizen__number="${n_section_base}"]`);
				} else {
					// 返信先ポップアップの場合、参照先はe_divの最後の子要素
					e_div_destination = e_div.lastChild;
				}

				if (e_div_destination.offsetTop < e_div.scrollTop) {
					e_div.scrollTo(0, e_div_destination.offsetTop);
				}

				/**
				 * @user の要素からmouseleaveしたら
				 * その後0.5秒以内にe_divにmouseenterしていなければe_divを削除する。
				 */
				var c_mouseleave_target = () => {
					o_timeout_id = setTimeout(() => e_div.remove(), 500);
					e_target.removeEventListener('mouseleave', c_mouseleave_target);
				};

				if (e_target.isConnected) {
					e_target.addEventListener('mouseleave', c_mouseleave_target);
				} else {
					// mouseoverした返信先コメントの中で、@userをmouseoverしたとき、e_targetを削除済。
					// その後3秒以内にe_divにmouseenterしていなければe_divを削除する。
					o_timeout_id = setTimeout(() => e_div.remove(), 3000);
				}

				/**
				 * e_divにmouseenterしたら
				 * e_divの削除を止める。
				 */
				var c_mouseenter_div = () => {
					clearTimeout(o_timeout_id);
				};

				/**
				 * e_divからmouseleaveしたら
				 * 0.5秒後にe_divを削除する。
				 */
				var c_mouseleave_div = () => {
					o_timeout_id = setTimeout(() => e_div.remove(), 500);
				};

				/**
				 * e_div内でclickした位置のコメントに移動する。
				 * @param {MouseEvent} e
				 */
				var c_click_div = (e) => {
					e.preventDefault();

					var e_section = e.target.closest('section');

					if (!e_section) {
						return;
					}

					var n_comment = e_section.dataset.qiita_comments_kaizen__number;
					var e_destination = document.querySelector(`#comments>section[data-qiita_comments_kaizen__number="${n_comment}"]`);

					e_div.remove();
					history.pushState({}, '', '');

					document.documentElement.scroll(0, e_destination.offsetTop);

					history.replaceState({}, '', `${location.pathname}#${e_section.id}`);
				};

				e_div.addEventListener('mouseenter', c_mouseenter_div);
				e_div.addEventListener('mouseleave', c_mouseleave_div);
				e_div.addEventListener('click', c_click_div);
			}
		};
	})();

	document.addEventListener('mouseover', c_mouseover);
}());
