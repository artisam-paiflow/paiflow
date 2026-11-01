# Hackathon photographs

Web derivatives of the event photographs supplied for issue #1090. Originals remain outside the repository.

| Asset prefix     | Supplied source                                            |
| ---------------- | ---------------------------------------------------------- |
| `jru-group`      | `jru/general.jpg`                                          |
| `jru-yolo`       | `jru/1-yolo.jpg`                                           |
| `jru-fourkey`    | `jru/2-fourkey.jpg`                                        |
| `jru-uhmtrylang` | `jru/3-uhmtrylang.jpg`                                     |
| `jru-typeshift`  | `jru/4-typeshift.jpg`                                      |
| `nvc-arrival`    | `nvc/844977186_1090447570508633_5494869034474987243_n.jpg` |
| `nvc-building`   | `nvc/855347315_1140399338464467_1675803585107808537_n.jpg` |
| `nvc-lab`        | `nvc/857494209_1643161264120187_4964348507368026212_n.jpg` |

## Winner and group photographs added November 1, 2026

Supplied from `hackathon pictures/`. Winner photos follow the placement order
confirmed by the user. These derivatives preserve the complete original frame;
portrait winner photos use `object-contain` in their cards.

| Asset prefix         | Supplied source           |
| -------------------- | ------------------------- |
| `nvc-group`          | `nvc/general.HEIC`        |
| `nvc-devorbit`       | `nvc/1st.HEIC`            |
| `nvc-clearpay`       | `nvc/2nd.HEIC`            |
| `nvc-freelanceflow`  | `nvc/3rd.HEIC`            |
| `iloilo-group`       | `web3iloilo/general.heic` |
| `iloilo-para`        | `web3iloilo/1st.heic`     |
| `iloilo-whitekadena` | `web3iloilo/2nd.heic`     |
| `iloilo-cyfer`       | `web3iloilo/3rd.heic`     |
| `iloilo-bayanihan`   | `web3iloilo/4th.heic`     |

The HEIC primary images are decoded with system libheif (including tiled image
assembly and orientation), then resized and encoded with Pillow. The original
files remain outside the repository. New web derivatives contain no EXIF, GPS,
or source metadata.

Images are auto-oriented, resized without enlargement and encoded as WebP at quality 80 (82 for 1800px hero derivatives). The arrival photo's `1280` derivative retains its original 960px width, declared accurately in HTML `srcset`. Social previews are 1200×630 JPEGs at quality 82. Source metadata is removed. Filenames and ordering do not establish award placements.
