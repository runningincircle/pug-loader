const path = require('path');
const PugPlugin = require('pug-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    devtool: isProd ? 'source-map' : 'inline-source-map',
    stats: 'minimal',

    resolve: {
      // aliases used in sources of pug, scss, js
      alias: {
        App: path.join(__dirname, 'src/app/'),
        Views: path.join(__dirname, 'src/views/'),
        Images: path.join(__dirname, 'src/assets/images/'),
        Fonts: path.join(__dirname, 'src/assets/fonts/'),
        Styles: path.join(__dirname, 'src/assets/styles/'),
        Scripts: path.join(__dirname, 'src/assets/scripts/'),
      },
    },

    output: {
      path: path.join(__dirname, 'public'),
      publicPath: '/',
      // output filename of scripts
      filename: 'assets/js/[name].[contenthash:8].js',
    },

    entry: {
      // !!! ATTENTION !!!
      //
      // The pug-plugin enable to use script and style source files directly in Pug, so easy:
      //
      //   link(href=require('./styles.scss') rel='stylesheet')
      //   script(src=require('./main.js'))
      //
      // Don't define styles and js files in entry. You can require source files of js and scss directly in Pug.
      // Don't use `html-webpack-plugin` to render Pug files in HTML. Pug plugin do it directly from here and much faster.
      // Don't use `mini-css-extract-plugin` to extract CSS from styles. Pug plugin extract CSS from style sources required in Pug.

      // Please, see more details under https://github.com/webdiscus/pug-plugin

      // Yes, You can define Pug files directly in entry, so easy:
      index: 'src/views/pages/home/index.pug',
    },

    plugins: [
      // enable processing of Pug files from entry
      new PugPlugin({
        verbose: !isProd, // output information about the process to console
        // module extracts CSS from style source files required directly in Pug
        extractCss: {
          // output filename of styles
          filename: 'assets/css/[name].[contenthash:8].css',
        },
      }),
    ],

    module: {
      rules: [
        {
          test: /\.pug$/,
          loader: PugPlugin.loader, // PugPlugin already contain the pug-loader
          options: {
            method: 'render', // fastest method to generate static HTML files
          },
        },

        // styles
        {
          test: /\.(css|sass|scss)$/,
          use: ['css-loader', 'sass-loader'],
        },

        // fonts
        {
          test: /\.(woff2?|ttf|otf|eot|svg)$/,
          type: 'asset/resource',
          include: /assets\/fonts/, // handles fonts from `assets/fonts` directory only
          generator: {
            // output filename of fonts
            filename: 'assets/fonts/[name][ext][query]',
          },
        },

        // images
        {
          test: /\.(png|svg|jpe?g|webp)$/i,
          type: 'asset/resource',
          include: /assets\/images/, // handle images from `assets/images` directory only
          generator: {
            // output filename of images
            filename: 'assets/img/[name].[hash:8][ext]',
          },
        },
      ],
    },

    devServer: {
      static: {
        directory: path.join(__dirname, 'public'),
      },
      compress: true,
      watchFiles: {
        paths: ['src/**/*.*'],
        options: {
          usePolling: true,
        },
      },

      // open in default browser
      open: true,
    },
  };
};
