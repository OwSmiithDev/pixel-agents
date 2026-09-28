# Órbita 3D (diorama + voxel) — Design

**Data:** 2026-09-28
**Status:** implementado na branch `feat/orbit-view` (opção B + C, demonstração "Diorama Smiith"); plano em `docs/superpowers/plans/2026-09-28-orbit-view.md`
**Branch:** `feat/orbit-view`

## Objetivo

Novo modo de visualização **Órbita**: a câmera gira 360°, inclina e aproxima em volta do escritório como num jogo 3D. Os modos 2D e 3D (isométrico fixo) continuam iguais.

## Decisões do usuário

1. O seletor de modo vira `2D | 3D | Órbita`. 2D e 3D não mudam.
2. Dentro da Órbita há uma chave **Miniatura** (câmera ortográfica) / **Jogo** (câmera em perspectiva). A escolha fica salva.
3. Técnica B + C: paredes e móveis viram geometria 3D. Alguns móveis viram voxel (um cubo por pixel), escolhidos pela **categoria** do catálogo.
4. Qualquer layout (editor, importado, gerado) funciona sem conversão. Nada novo no formato do layout.

## Fora do escopo

- Editor de layout em 3D (continua só no 2D; a Órbita fica bloqueada durante edição e tour, como o 3D).
- Modelos GLTF, personagens 3D, minimapa.
- Mudanças no motor (`officeState`), no servidor ou no formato do layout.

## Como cada coisa vira 3D

| Origem                                                                           | Regra                                  | Resultado                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tile `WALL`                                                                      | sempre                                 | Bloco de altura `ORBIT_WALL_HEIGHT` (1,5 tile), cor da parede (`tileColors` via `wallColorToHex`, cinza grafite padrão). Abaixa quando fica entre a câmera e o alvo (corte).                                                  |
| Tiles de chão, carpetes, `VOID`                                                  | sempre                                 | Reusa `FloorLayer` do 3D atual sem mudança.                                                                                                                                                                                   |
| Móvel `category: 'electronics'`                                                  | voxel                                  | PC, monitores.                                                                                                                                                                                                                |
| Móvel com `canPlaceOnWalls`                                                      | voxel, encostado na parede             | Estantes de parede, quadros, quadro branco, relógio.                                                                                                                                                                          |
| Móvel `category: 'misc'`                                                         | voxel                                  | Lixeira, café.                                                                                                                                                                                                                |
| Móvel `category: 'desks'`                                                        | bloco (tampo + frente)                 | Mesas, mesa de centro, mesa de reunião.                                                                                                                                                                                       |
| Móvel `category: 'chairs'` com `footprintW × (footprintH − backgroundTiles) ≥ 2` | bloco                                  | Sofás (frente e lado). Cadeira de madeira (1 × (2 − 1) = 1) não entra.                                                                                                                                                        |
| Demais `chairs`                                                                  | recorte com direção                    | Cadeiras: a direção no mundo vem de `getOrientationInGroup(type)`; o sprite mostrado é o do irmão do grupo de rotação correspondente à direção vista (`getRotatedType` cw/ccw). Sem grupo de rotação, vira recorte de eixo Y. |
| Móvel `category: 'decor'` e categorias desconhecidas                             | recorte de eixo Y                      | Plantas, cactos, vasos.                                                                                                                                                                                                       |
| Item com `canPlaceOnSurfaces` sobre uma mesa                                     | sobe para a altura do tampo            | PC em cima da mesa, café na mesa de centro.                                                                                                                                                                                   |
| Personagens e pets                                                               | recorte de eixo Y com direção relativa | Mesmo sprite do 2D, escolhido por `relativeDirection(dir, yaw)`.                                                                                                                                                              |
| Balões (permissão/espera)                                                        | recorte de eixo Y acima da cabeça      | Sempre na frente (render order alto, como hoje).                                                                                                                                                                              |

Exceções por tipo ficam numa constante `ORBIT_KIND_OVERRIDES: Record<string, OrbitKind>` (começa vazia). Não há configuração externa.

A cor aplicada no editor já está no `sprite` da instância (`getColorizedSprite`). Voxel e texturas leem esse sprite, então a cor vale no 3D.

### Geometria do bloco

Arte top-down "3/4": as linhas de cima do sprite mostram o tampo, as de baixo mostram a frente. Para um sprite de altura `H` px com footprint de `fh` tiles:

- `frontPx = clamp(round(H * 0.3), 4, 12)` linhas de baixo (dentro do retângulo opaco) = face da frente e de trás.
- Demais linhas opacas = tampo, esticado sobre a profundidade do footprint.
- Altura do bloco = `frontPx / 16` tiles (mesa ≈ 0,6).
- Laterais = coluna opaca mais à esquerda da faixa da frente, esticada.
- Faces com `alphaTest`, então pés e vãos vazados continuam vazados.

### Voxel

- Um cubo `1/16` por pixel opaco (alpha ≥ 128) do retângulo opaco, em `InstancedMesh` com cor por instância.
- Profundidade padrão por categoria: `electronics` 3 px, itens de parede 2 px, `misc` 6 px.
- Pixels claros (luminância > 0,55) ficam 1 px recuados quando a profundidade é > 2 (tela afundada, lombada de livro).
- Monitores ligados: o sprite muda a cada quadro de animação (auto-state do motor). Mesmas posições, só as cores são atualizadas (`instanceColor`), sem recriar a malha. Se a máscara opaca mudar (ex.: OFF → ON), a malha é recriada.
- Itens `electronics` sobre mesa: as linhas que representam a parte deitada (teclado) viram voxels deitados sobre o tampo; o resto fica em pé. Divisão: primeira linha totalmente transparente abaixo do bloco superior; sem linha vazia, tudo fica em pé.

## Câmera e controles

- `CameraControls` do `@react-three/drei` (já instalado; nenhuma dependência nova).
- Arrastar com botão esquerdo gira; botão direito ou do meio move; roda aproxima (zoom na Miniatura, distância no Jogo). Os botões +/− do app também mudam a escala da câmera.
- Pitch limitado entre 20° e 78°. Alvo preso ao retângulo do layout (`CameraControls.setBoundary`). Zoom limitado.
- Q/E giram 90° com animação; R volta ao ângulo inicial (pitch 52°, yaw 35°).
- Clique só conta como clique se o ponteiro mexeu menos de 4 px entre apertar e soltar (senão foi giro).
- Seguir agente (`cameraFollowId`) e alvo do tour (`greeterCameraTarget`) movem o alvo com a mesma suavização de hoje. Arrastar cancela o seguir.
- `prefers-reduced-motion`: sem inércia e sem animação de giro.
- Miniatura: `OrthographicCamera`, zoom = mesmo `zoom` do app. Jogo: `PerspectiveCamera` FOV 38°, distância derivada do zoom. Trocar mantém yaw, pitch e alvo.
- Ângulo, pitch e projeção salvos em `localStorage` (try/catch, mesmo padrão de `viewMode.ts`).

## Corte de paredes

Para cada tile de parede, a normal de saída é a direção dos vizinhos que não são parede de interior. Implementação simples e suficiente: a parede é cortada quando está do lado da câmera em relação ao alvo e o ângulo entre `parede → alvo` e `câmera → alvo` no plano XZ é menor que 70°, a até 14 tiles do alvo. Função pura `shouldCutWall(wall, target, camera)`. A altura anima até 0,15 tile (sem transparência, para evitar problema de ordem de alpha).

## Arquitetura

Novos arquivos em `webview-ui/src/office/three/orbit/`:

| Arquivo              | Responsabilidade                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `orbitMath.ts`       | Funções puras: `relativeDirection`, `snapYaw`, `shouldCutWall`, `perspDistance`.                               |
| `orbitKind.ts`       | Função pura `orbitKind(entry, footprint)` → `'voxel' \| 'box' \| 'dirCard' \| 'yCard'`, com overrides.         |
| `voxelize.ts`        | Função pura `voxelize(sprite, opts)` → lista de células (posição, cor, profundidade, deitado/em pé).           |
| `boxFaces.ts`        | Função pura `boxFaces(sprite, footprint)` → faixas de linhas do tampo/frente, altura, coluna lateral.          |
| `OrbitRig.tsx`       | `CameraControls`, limites, atalhos, seguir agente, persistência, projetor para as legendas.                    |
| `OrbitWalls.tsx`     | Blocos instanciados das paredes + corte.                                                                       |
| `OrbitFurniture.tsx` | Monta blocos, voxels e recortes a partir de `officeState.furniture`.                                           |
| `OrbitActors.tsx`    | Personagens, pets e balões como recortes de eixo Y com direção relativa; picking.                              |
| `OrbitScene.tsx`     | Canvas, luzes (reusa `KeyLight`, `MonitorLights`, `Effects`, `FloorLayer`), junta tudo. Lazy, como `Office3D`. |

Mudanças em arquivos existentes:

- `viewMode.ts`: `ViewMode = '2d' | '3d' | 'orbit'`; ler/gravar `'orbit'`. Novo `OrbitProjection = 'ortho' | 'persp'` com ler/gravar próprios.
- `ViewToggle.tsx`: terceiro botão `Órbita`; quando ativo, mostra a chave `Miniatura | Jogo` ao lado.
- `App.tsx`: renderiza `OrbitScene` quando `viewMode === 'orbit'` (mesmo bloqueio do 3D).
- `layoutSerializer.ts` (`layoutToFurnitureInstances`) e `types.ts` (`FurnitureInstance`): acrescentar campos opcionais `type`, `col`, `row` para a Órbita achar a entrada do catálogo. Não muda nada para 2D/3D.
- `constants.ts`: constantes `ORBIT_*`.

O motor continua o único dono do estado: a Órbita só lê `officeState` a cada quadro e chama `officeState.update(dt)` (como `CameraRig` faz hoje). Clique usa `applyOfficeClick`, como o 3D.

`ToolOverlay` e o painel do agente já usam um `ScreenProjector`; a Órbita fornece o seu (projeta ponto 3D → tela), então legendas e painel funcionam sem mudança.

## Desempenho

- Paredes: um `InstancedMesh`. Voxels: um `InstancedMesh` por móvel voxel (layout Smiith Tech ≈ 40 itens × ~250 cubos ≈ 10 mil instâncias).
- Geometrias e texturas cacheadas por `sprite` (identidade do objeto) em `WeakMap`.
- Malhas só são recriadas quando `officeState.furniture` muda de referência (o motor recria o array ao mudar layout ou estado ON/OFF).
- Meta: 60 fps no Smiith Tech 40×30 com 20 agentes; bundle da Órbita lazy e ≤ 40 kB gzip além do 3D atual.

## Erros e casos limite

- Entrada de catálogo ausente: o item é ignorado (mesmo comportamento do 2D).
- Sprite sem pixel opaco: nada é desenhado.
- Layout sem paredes, com buracos (`VOID`) ou irregular: funciona; o corte só age sobre paredes existentes.
- Troca de layout ou importação com a Órbita aberta: tudo é reconstruído na próxima mudança de `officeState.furniture` / `tileMap`.
- WebGL indisponível: mesmo tratamento do 3D atual.

## Testes

- Vitest (node) para as funções puras: `relativeDirection` (0°, 90°, 180°, 270°), `snapYaw`, `perspDistance`, `shouldCutWall` (parede entre câmera e alvo, atrás, ao lado), `orbitKind` (cada categoria, override, desconhecida), `voxelize` (contagem de células, recuo de pixel claro, divisão em pé/deitado do PC real), `boxFaces` (mesa real `DESK_FRONT`, sofá, mesa de centro), `viewMode` (ler/gravar `'orbit'` e projeção, valor inválido volta ao padrão).
- Checagem visual com Playwright no modo navegador (`npm run dev` + mensagens simuladas, como o script usado nas rotinas): Smiith Tech e template de 10 agentes, em Miniatura e Jogo, nos yaws 0°, 90°, 180°, 270°; clique em agente abre o painel; legenda acompanha; paredes da frente cortadas.
- `npm run build` (tipos, lint, bundle) e suíte vitest completa sem regressão. E2E existente continua rodando (a Órbita não muda o fluxo padrão, que abre em 2D).

## Decisões tomadas na implementação

- O "recorte" (plano com sprite) usado por personagens, cadeiras e plantas fica num só lugar: `orbit/card.ts`.
- `snapYaw` arredonda para o quarto de volta mais próximo (o teste do plano tinha um erro de digitação).
- Itens de parede também procuram a parede na linha logo acima do footprint (layouts antigos colocam estantes no chão,
  encostadas na parede).
- Trocar Miniatura ↔ Jogo recria o canvas; alvo, yaw e pitch são restaurados do estado compartilhado da câmera.
- Trocar de layout com a Órbita aberta: o limite da câmera é refeito; paredes e móveis são reconstruídos.
- Q/E/R são ignorados com Ctrl/Cmd/Alt (não brigam com atalhos do VS Code).
- Aceito como está: depois de zoom pela roda, os botões + − voltam aos passos inteiros do app.
- Adiado: clique atravessa paredes; número de chamadas de desenho (~550) só será otimizado se o fps real ficar abaixo
  de 60 em GPU real.
