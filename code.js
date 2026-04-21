figma.showUI(__html__, { width: 520, height: 760, title: 'Usability Analyzer' });

// 선택 변경 시 UI에 알림
figma.on('selectionchange', () => {
  sendSelectionInfo();
});

// 초기 선택 정보 전송
sendSelectionInfo();

figma.ui.onmessage = async (msg) => {

  if (msg.type === 'get-selection') {
    sendSelectionInfo();
  }

  if (msg.type === 'analyze') {
    const selection = figma.currentPage.selection;

    if (selection.length === 0) {
      figma.ui.postMessage({ type: 'error', message: '분석할 프레임을 먼저 선택해 주세요.' });
      return;
    }

    const node = selection[0];

    try {
      figma.ui.postMessage({ type: 'progress', step: 1, message: '📸 PNG 캡처 중...' });

      const bytes = await node.exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 2 }
      });

      figma.ui.postMessage({ type: 'progress', step: 2, message: '🔍 구조 분석 중...' });

      const tree = buildTree(node, 0);
      const colorPalette = extractColors(node);
      const textStyles = extractTextStyles(node);

      figma.ui.postMessage({
        type: 'data',
        image: Array.from(bytes),
        tree: JSON.stringify(tree, null, 2),
        colorPalette,
        textStyles,
        nodeName: node.name,
        nodeType: node.type,
        nodeSize: {
          width: Math.round(node.width),
          height: Math.round(node.height)
        }
      });

    } catch (e) {
      figma.ui.postMessage({ type: 'error', message: '캡처 실패: ' + e.message });
    }
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};

function sendSelectionInfo() {
  const selection = figma.currentPage.selection;
  if (selection.length > 0) {
    const node = selection[0];
    figma.ui.postMessage({
      type: 'selection',
      name: node.name,
      nodeType: node.type,
      width: Math.round(node.width),
      height: Math.round(node.height)
    });
  } else {
    figma.ui.postMessage({ type: 'selection', name: null });
  }
}

function buildTree(node, depth) {
  if (depth > 5) {
    return { name: node.name, type: node.type, _note: 'depth limit' };
  }

  const result = {
    name: node.name,
    type: node.type,
  };

  // 크기
  if ('width' in node) {
    result.size = {
      w: Math.round(node.width),
      h: Math.round(node.height)
    };
  }

  // 텍스트
  if (node.type === 'TEXT') {
    result.text = node.characters;
    const fs = node.fontSize;
    const fn = node.fontName;
    result.typography = {
      fontSize: typeof fs === 'number' ? fs : 'mixed',
      fontStyle: typeof fn !== 'symbol' ? fn.style : 'mixed',
      fontFamily: typeof fn !== 'symbol' ? fn.family : 'mixed',
      textAlign: node.textAlignHorizontal,
      lineHeight: node.lineHeight,
      letterSpacing: node.letterSpacing,
    };
  }

  // 색상
  if ('fills' in node && Array.isArray(node.fills)) {
    const visibleFills = node.fills.filter(f => f.visible !== false && f.opacity !== 0);
    if (visibleFills.length > 0) {
      result.fills = visibleFills.map(fill => {
        if (fill.type === 'SOLID') {
          return {
            type: 'SOLID',
            color: rgbToHex(fill.color.r, fill.color.g, fill.color.b),
            opacity: fill.opacity !== undefined ? Math.round(fill.opacity * 100) + '%' : '100%'
          };
        }
        return { type: fill.type };
      });
    }
  }

  // 스트로크
  if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length > 0) {
    result.strokes = node.strokes.map(s => {
      if (s.type === 'SOLID') {
        return { color: rgbToHex(s.color.r, s.color.g, s.color.b) };
      }
      return { type: s.type };
    });
  }

  // Auto Layout
  if ('layoutMode' in node && node.layoutMode !== 'NONE') {
    result.autoLayout = {
      direction: node.layoutMode,
      padding: {
        top: node.paddingTop,
        right: node.paddingRight,
        bottom: node.paddingBottom,
        left: node.paddingLeft
      },
      gap: node.itemSpacing,
      mainAxisAlign: node.primaryAxisAlignItems,
      crossAxisAlign: node.counterAxisAlignItems,
    };
  }

  // 모서리 반경
  if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    result.cornerRadius = node.cornerRadius;
  }

  // 불투명도
  if ('opacity' in node && node.opacity !== 1) {
    result.opacity = Math.round(node.opacity * 100) + '%';
  }

  // 자식 노드
  if ('children' in node && node.children.length > 0) {
    const MAX_CHILDREN = 15;
    const children = node.children.slice(0, MAX_CHILDREN);
    result.children = children.map(child => buildTree(child, depth + 1));
    if (node.children.length > MAX_CHILDREN) {
      result._childrenNote = `(${node.children.length}개 중 ${MAX_CHILDREN}개 표시)`;
    }
  }

  return result;
}

// 프레임 전체에서 사용된 색상 추출
function extractColors(node, colors = new Set()) {
  if ('fills' in node && Array.isArray(node.fills)) {
    node.fills.filter(f => f.type === 'SOLID' && f.visible !== false).forEach(f => {
      colors.add(rgbToHex(f.color.r, f.color.g, f.color.b));
    });
  }
  if ('children' in node) {
    node.children.forEach(c => extractColors(c, colors));
  }
  return Array.from(colors).slice(0, 20);
}

// 프레임 전체에서 텍스트 스타일 추출
function extractTextStyles(node, styles = []) {
  if (node.type === 'TEXT') {
    const fs = node.fontSize;
    const fn = node.fontName;
    if (typeof fs === 'number' && typeof fn !== 'symbol') {
      const key = `${fn.family}-${fn.style}-${fs}`;
      if (!styles.find(s => s.key === key)) {
        styles.push({
          key,
          family: fn.family,
          style: fn.style,
          size: fs,
          sample: node.characters.slice(0, 30)
        });
      }
    }
  }
  if ('children' in node) {
    node.children.forEach(c => extractTextStyles(c, styles));
  }
  return styles.slice(0, 10);
}

function rgbToHex(r, g, b) {
  const h = v => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}
