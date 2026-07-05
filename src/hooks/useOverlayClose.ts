import { useCallback, useRef } from "react";

/**
 * T-136: モーダルのオーバーレイ誤クローズ防止フック。
 *
 * 問題: オーバーレイ（背景 div）に onClick で閉じる実装だと、「モーダル内で mousedown →
 *   ドラッグして枠外(オーバーレイ)で mouseup」した際、click が mousedown/mouseup の共通祖先
 *   （＝オーバーレイ）で発火して閉じてしまい、入力内容が失われる。
 *
 * 対策: 「mousedown がオーバーレイ自身で始まった場合のみ」オーバーレイクリックで閉じる。
 *   外側を普通にクリックして閉じる既存挙動は維持（バグ修正であり仕様変更ではない）。
 *
 * 使い方:
 *   const overlayClose = useOverlayClose(() => setOpen(false));
 *   <div className="fixed inset-0 ..." {...overlayClose}>
 *     <div onClick={(e) => e.stopPropagation()}>...本体...</div>
 *   </div>
 *
 * 本体側の e.stopPropagation() は併用してよい（残してよい）。
 */
export function useOverlayClose(onClose: () => void) {
  const startedOnOverlay = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // mousedown がオーバーレイ自身（currentTarget）で始まったかを記録
    startedOnOverlay.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      // オーバーレイ上で始まり・オーバーレイ上で終わったクリックのみ閉じる
      if (startedOnOverlay.current && e.target === e.currentTarget) {
        onClose();
      }
      startedOnOverlay.current = false;
    },
    [onClose],
  );

  return { onMouseDown, onClick };
}
