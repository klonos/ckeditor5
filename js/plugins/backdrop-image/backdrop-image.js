/**
 * @file
 * Contains BackdropImage CKEditor 5 plugin and its dependent classes.
 */
(function (CKEditor5) {

/**
 * BackdropImage CKEditor 5 plugin.
 *
 * This complex plugin provides several pieces of key functionality:
 *
 * - Provides an image upload adapter to save images to Backdrop's file system.
 * - Saves data-file-id attributes on img tags which Backdrop uses to track
 *   where files are being used.
 * - Connects to a Backdrop-native dialog via an AJAX request.
 *
 * If this were developed under the normal CKEditor build process, this would
 * likely be split into multiple plugins and files. Backdrop does not use a
 * compilation step, so what is normally 5-8 files is all done in a single file.
 */
class BackdropImage extends CKEditor5.core.Plugin {
  /**
   * @inheritdoc
   */
  static get requires() {
    return ['ImageUtils', 'FileRepository'];
  }

  /**
   * @inheritdoc
   */
  static get pluginName() {
    return 'BackdropImage';
  }

  /**
   * @inheritdoc
   */
  init() {
    const editor = this.editor;
    const { conversion } = editor;
    const { schema } = editor.model;
    const options = editor.config.get('backdropImage');

    if (schema.isRegistered('imageInline')) {
      schema.extend('imageInline', {
        allowAttributes: [
          'dataFileId',
          'isDecorative',
          'width',
          'height',
        ],
      });
    }

    if (schema.isRegistered('imageBlock')) {
      schema.extend('imageBlock', {
        allowAttributes: [
          'dataFileId',
          'isDecorative',
          'width',
          'height',
        ],
      });
    }

    // Conversion.
    conversion
      .for('upcast')
      .add(viewImageToModelImage(editor))
      .attributeToAttribute({
        view: {
          name: 'img',
          key: 'width',
        },
        model: {
          key: 'width',
          value: (viewElement) => {
            if (isNumberString(viewElement.getAttribute('width'))) {
              return `${viewElement.getAttribute('width')}px`;
            }
            return `${viewElement.getAttribute('width')}`;
          },
        },
      })
      .attributeToAttribute({
        view: {
          name: 'img',
          key: 'height',
        },
        model: {
          key: 'height',
          value: (viewElement) => {
            if (isNumberString(viewElement.getAttribute('height'))) {
              return `${viewElement.getAttribute('height')}px`;
            }
            return `${viewElement.getAttribute('height')}`;
          },
        },
      });

    conversion
      .for('downcast')
      .add(modelFileIdToDataAttribute());

    conversion
      .for('dataDowncast')
      .add(viewCaptionToCaptionAttribute(editor))
      .elementToElement({
        model: 'imageBlock',
        view: (modelElement, { writer }) =>
          createImageViewElement(writer, 'imageBlock'),
        converterPriority: 'high',
      })
      .elementToElement({
        model: 'imageInline',
        view: (modelElement, { writer }) =>
          createImageViewElement(writer, 'imageInline'),
        converterPriority: 'high',
      })
      .add(modelImageStyleToDataAttribute())
      .add(modelImageWidthToAttribute())
      .add(modelImageHeightToAttribute())
      .add(downcastBlockImageLink());

    // Add the backdropImage toolbar button.
    editor.ui.componentFactory.add('backdropImage', () => {
      // Use upstream insertImage component when ImageInsertUI is enabled. The
      // upstream insertImage button supports inserting of external images
      // and uploading images. Out-of-the-box Drupal only uses the insertImage
      // button for inserting external images.
      if (editor.plugins.has('ImageInsertUI')) {
        return editor.ui.componentFactory.create('insertImage');
      }
      // If ImageInsertUI plugin is not enabled, fallback to using uploadImage
      // upstream button.
      if (editor.plugins.has('ImageUpload')) {
        return editor.ui.componentFactory.create('uploadImage');
      }

      throw new Error(
        'backdropImage requires either ImageUpload or ImageInsertUI plugin to be enabled.',
      );
    });

    // Attach the file upload adapter to handle saving files.
    if (!options.uploadUrl) {
      throw new Error('Missing backdropImage.uploadUrl configuration option.');
    }
    editor.plugins.get('FileRepository').createUploadAdapter = (loader) => {
      return new BackdropImageUploadAdapter(loader, options);
    };

    // Upon completing an uploaded file, save the returned File ID.
    const imageUploadEditing = editor.plugins.get('ImageUploadEditing');
    imageUploadEditing.on('uploadComplete', (evt, { data, imageElement }) => {
      editor.model.change((writer) => {
        writer.setAttribute('dataFileId', data.response.fileId, imageElement);
      });
    });

  }
}

// Expose the plugin to the CKEditor5 namespace.
CKEditor5.backdropImage = {
  'BackdropImage': BackdropImage
};

/**
 * Helper function for the downcast converter.
 *
 * Sets attributes on the given view element. This function is copied from
 * the General HTML Support plugin.
 * See https://ckeditor.com/docs/ckeditor5/latest/api/module_html-support_conversionutils.html#function-setViewAttributes
 *
 * @param writer The view writer.
 * @param viewAttributes The GHS attribute value.
 * @param viewElement The view element to update.
 */
function setViewAttributes(writer, viewAttributes, viewElement) {
  if (viewAttributes.attributes) {
    for (const [key, value] of Object.entries(viewAttributes.attributes)) {
      writer.setAttribute(key, value, viewElement);
    }
  }

  if (viewAttributes.styles) {
    writer.setStyle(viewAttributes.styles, viewElement);
  }

  if (viewAttributes.classes ) {
    writer.addClass(viewAttributes.classes, viewElement);
  }
}

/**
 * Provides an empty image element.
 *
 * @param {writer} writer
 *  The CKEditor 5 writer object.
 *
 * @return {module:engine/view/emptyelement~EmptyElement}
 *  The empty image element.
 *
 * @private
 */
function createImageViewElement(writer) {
  return writer.createEmptyElement('img');
}

/**
 * A simple helper method to detect number strings.
 *
 * @param {*} value
 *  The value to test.
 *
 * @return {boolean}
 *  True if the value is a string containing a number.
 *
 * @private
 */
function isNumberString(value) {
  const parsedValue = parseFloat(value);

  return !Number.isNaN(parsedValue) && value === String(parsedValue);
}

/**
 * Generates a callback that saves the entity UUID to an attribute on data
 * downcast.
 *
 * @return {function}
 *  Callback that binds an event to its parameter.
 *
 * @private
 */
function modelFileIdToDataAttribute() {
  /**
   * Callback for the attribute:dataFileId event.
   *
   * Saves the File ID value to the data-file-id attribute.
   *
   * @param {Event} event
   * @param {object} data
   * @param {module:engine/conversion/downcastdispatcher~DowncastConversionApi} conversionApi
   */
  function converter(event, data, conversionApi) {
    const { item } = data;
    const { consumable, writer } = conversionApi;

    if (!consumable.consume(item, event.name)) {
      return;
    }

    const viewElement = conversionApi.mapper.toViewElement(item);
    const imageInFigure = Array.from(viewElement.getChildren()).find(
      (child) => child.name === 'img',
    );

    writer.setAttribute(
      'data-file-id',
      data.attributeNewValue,
      imageInFigure || viewElement,
    );
  }

  return (dispatcher) => {
    dispatcher.on('attribute:dataFileId', converter);
  };
}

/**
 * @type {Array.<{dataValue: string, modelValue: string}>}
 */
const alignmentMapping = [
  {
    modelValue: 'alignCenter',
    dataValue: 'center',
  },
  {
    modelValue: 'alignRight',
    dataValue: 'right',
  },
  {
    modelValue: 'alignLeft',
    dataValue: 'left',
  },
];

/**
 * Downcasts `caption` model to `data-caption` attribute with its content
 * downcasted to plain HTML.
 *
 * This is needed because CKEditor 5 uses the `<caption>` element internally in
 * various places, which differs from Backdrop which uses an attribute. For now
 * to support that we have to manually repeat work done in the
 * DowncastDispatcher's private methods.
 *
 * @param {module:core/editor/editor~Editor} editor
 *  The editor instance to use.
 *
 * @return {function}
 *  Callback that binds an event to its parameter.
 *
 * @private
 */
function viewCaptionToCaptionAttribute(editor) {
  return (dispatcher) => {
    dispatcher.on(
      'insert:caption',
      (event, data, conversionApi) => {
        const { consumable, writer, mapper } = conversionApi;
        const imageUtils = editor.plugins.get('ImageUtils');

        if (
          !imageUtils.isImage(data.item.parent) ||
          !consumable.consume(data.item, 'insert')
        ) {
          return;
        }

        const range = editor.model.createRangeIn(data.item);
        const viewDocumentFragment = writer.createDocumentFragment();

        // Bind caption model element to the detached view document fragment so
        // all content of the caption will be downcasted into that document
        // fragment.
        mapper.bindElements(data.item, viewDocumentFragment);

        // eslint-disable-next-line no-restricted-syntax
        for (const { item } of Array.from(range)) {
          const itemData = {
            item,
            range: editor.model.createRangeOn(item),
          };

          // The following lines are extracted from
          // DowncastDispatcher._convertInsertWithAttributes().
          const eventName = `insert:${item.name || '$text'}`;

          editor.data.downcastDispatcher.fire(
            eventName,
            itemData,
            conversionApi,
          );

          // eslint-disable-next-line no-restricted-syntax
          for (const key of item.getAttributeKeys()) {
            Object.assign(itemData, {
              attributeKey: key,
              attributeOldValue: null,
              attributeNewValue: itemData.item.getAttribute(key),
            });

            editor.data.downcastDispatcher.fire(
              `attribute:${key}`,
              itemData,
              conversionApi,
            );
          }
        }

        // Unbind all the view elements that were downcasted to the document
        // fragment.
        // eslint-disable-next-line no-restricted-syntax
        for (const child of writer
          .createRangeIn(viewDocumentFragment)
          .getItems()) {
          mapper.unbindViewElement(child);
        }

        mapper.unbindViewElement(viewDocumentFragment);

        // Stringify view document fragment to HTML string.
        const captionText = editor.data.processor.toData(viewDocumentFragment);

        if (captionText) {
          const imageViewElement = mapper.toViewElement(data.item.parent);

          writer.setAttribute('data-caption', captionText, imageViewElement);
        }
      },
      // Override default caption converter.
      { priority: 'high' },
    );
  };
}

/**
 * Generates a callback that saves the align value to an attribute on
 * data downcast.
 *
 * @return {function}
 *  Callback that binds an event to its parameter.
 *
 * @private
 */
function modelImageStyleToDataAttribute() {
  /**
   * Callback for the attribute:imageStyle event.
   *
   * Saves the alignment value to the data-align attribute.
   */
  function converter(event, data, conversionApi) {
    const { item } = data;
    const { consumable, writer } = conversionApi;

    const mappedAlignment = alignmentMapping.find(
      (value) => value.modelValue === data.attributeNewValue,
    );

    // Consume only for the values that can be converted into data-align.
    if (!mappedAlignment || !consumable.consume(item, event.name)) {
      return;
    }

    const viewElement = conversionApi.mapper.toViewElement(item);
    const imageInFigure = Array.from(viewElement.getChildren()).find(
      (child) => child.name === 'img',
    );

    writer.setAttribute(
      'data-align',
      mappedAlignment.dataValue,
      imageInFigure || viewElement,
    );
  }

  return (dispatcher) => {
    dispatcher.on('attribute:imageStyle', converter, { priority: 'high' });
  };
}

/**
 * Generates a callback that saves the width value to an attribute on
 * data downcast.
 *
 * @return {function}
 *  Callback that binds an event to its parameter.
 *
 * @private
 */
function modelImageWidthToAttribute() {
  /**
   * Callback for the attribute:width event.
   *
   * Saves the width value to the width attribute.
   */
  function converter(event, data, conversionApi) {
    const { item } = data;
    const { consumable, writer } = conversionApi;

    if (!consumable.consume(item, event.name)) {
      return;
    }

    const viewElement = conversionApi.mapper.toViewElement(item);
    const imageInFigure = Array.from(viewElement.getChildren()).find(
      (child) => child.name === 'img',
    );

    writer.setAttribute(
      'width',
      data.attributeNewValue.replace('px', ''),
      imageInFigure || viewElement,
    );
  }

  return (dispatcher) => {
    dispatcher.on('attribute:width:imageInline', converter, {
      priority: 'high',
    });
    dispatcher.on('attribute:width:imageBlock', converter, {
      priority: 'high',
    });
  };
}

/**
 * Generates a callback that saves the height value to an attribute on
 * data downcast.
 *
 * @return {function}
 *  Callback that binds an event to its parameter.
 *
 * @private
 */
function modelImageHeightToAttribute() {
  /**
   * Callback for the attribute:height event.
   *
   * Saves the height value to the height attribute.
   */
  function converter(event, data, conversionApi) {
    const { item } = data;
    const { consumable, writer } = conversionApi;

    if (!consumable.consume(item, event.name)) {
      return;
    }

    const viewElement = conversionApi.mapper.toViewElement(item);
    const imageInFigure = Array.from(viewElement.getChildren()).find(
      (child) => child.name === 'img',
    );

    writer.setAttribute(
      'height',
      data.attributeNewValue.replace('px', ''),
      imageInFigure || viewElement,
    );
  }

  return (dispatcher) => {
    dispatcher.on('attribute:height:imageInline', converter, {
      priority: 'high',
    });
    dispatcher.on('attribute:height:imageBlock', converter, {
      priority: 'high',
    });
  };
}

/**
 * Generates a callback that handles the data downcast for the img element.
 *
 * @return {function}
 *  Callback that binds an event to its parameter.
 *
 * @private
 */
function viewImageToModelImage(editor) {
  /**
   * Callback for the element:img event.
   *
   * Handles the Backdrop specific attributes.
   */
  function converter(event, data, conversionApi) {
    const { viewItem } = data;
    const { writer, consumable, safeInsert, updateConversionResult, schema } =
      conversionApi;
    const attributesToConsume = [];

    let image;

    // Not only check if a given `img` view element has been consumed, but also
    // verify it has `src` attribute present.
    if (!consumable.test(viewItem, { name: true, attributes: 'src' })) {
      return;
    }

    const hasDataCaption = consumable.test(viewItem, {
      name: true,
      attributes: 'data-caption',
    });

    // Create image that's allowed in the given context. If the image has a
    // caption, the image must be created as a block image to ensure the caption
    // is not lost on conversion. This is based on the assumption that
    // preserving the image caption is more important to the content creator
    // than preserving the wrapping element that doesn't allow block images.
    if (schema.checkChild(data.modelCursor, 'imageInline') && !hasDataCaption) {
      image = writer.createElement('imageInline', {
        src: viewItem.getAttribute('src'),
      });
    } else {
      image = writer.createElement('imageBlock', {
        src: viewItem.getAttribute('src'),
      });
    }

    // The way that image styles are handled here is naive - it assumes that the
    // image styles are configured exactly as expected by this plugin.
    // @todo Add support for custom image style configurations
    //   https://www.drupal.org/i/3270693.
    if (
      editor.plugins.has('ImageStyleEditing') &&
      consumable.test(viewItem, { name: true, attributes: 'data-align' })
    ) {
      const dataAlign = viewItem.getAttribute('data-align');
      const mappedAlignment = alignmentMapping.find(
        (value) => value.dataValue === dataAlign,
      );

      if (mappedAlignment) {
        writer.setAttribute('imageStyle', mappedAlignment.modelValue, image);

        // Make sure the attribute can be consumed after successful `safeInsert`
        // operation.
        attributesToConsume.push('data-align');
      }
    }

    // Check if the view element has still unconsumed `data-caption` attribute.
    if (hasDataCaption) {
      // Create `caption` model element. Thanks to that element the rest of the
      // `ckeditor5-plugin` converters can recognize this image as a block image
      // with a caption.
      const caption = writer.createElement('caption');

      // Parse HTML from data-caption attribute and upcast it to model fragment.
      const viewFragment = editor.data.processor.toView(
        viewItem.getAttribute('data-caption'),
      );

      // Consumable must know about those newly parsed view elements.
      conversionApi.consumable.constructor.createFrom(
        viewFragment,
        conversionApi.consumable,
      );
      conversionApi.convertChildren(viewFragment, caption);

      // Insert the caption element into image, as a last child.
      writer.append(caption, image);

      // Make sure the attribute can be consumed after successful `safeInsert`
      // operation.
      attributesToConsume.push('data-caption');
    }

    if (
      consumable.test(viewItem, { name: true, attributes: 'data-file-id' })
    ) {
      writer.setAttribute(
        'dataFileId',
        viewItem.getAttribute('data-file-id'),
        image,
      );
      attributesToConsume.push('data-file-id');
    }

    // Try to place the image in the allowed position.
    if (!safeInsert(image, data.modelCursor)) {
      return;
    }

    // Mark given element as consumed. Now other converters will not process it
    // anymore.
    consumable.consume(viewItem, {
      name: true,
      attributes: attributesToConsume,
    });

    // Make sure `modelRange` and `modelCursor` is up to date after inserting
    // new nodes into the model.
    updateConversionResult(image, data);
  }

  return (dispatcher) => {
    dispatcher.on('element:img', converter, { priority: 'high' });
  };
}

/**
 * Modified alternative implementation of linkimageediting.js' downcastImageLink.
 *
 * @return {function}
 *  Callback that binds an event to its parameter.
 *
 * @private
 */
function downcastBlockImageLink() {
  /**
   * Callback for the attribute:linkHref event.
   */
  function converter(event, data, conversionApi) {
    if (!conversionApi.consumable.consume(data.item, event.name)) {
      return;
    }

    // The image will be already converted - so it will be present in the view.
    const image = conversionApi.mapper.toViewElement(data.item);
    const writer = conversionApi.writer;

    // 1. Create an empty link element.
    const linkElement = writer.createContainerElement('a', {
      href: data.attributeNewValue,
    });
    // 2. Insert link before the associated image.
    writer.insert(writer.createPositionBefore(image), linkElement);
    // 3. Move the image into the link.
    writer.move(
      writer.createRangeOn(image),
      writer.createPositionAt(linkElement, 0),
    );

    // Modified alternative implementation of GHS' addBlockImageLinkAttributeConversion().
    // This is happening here as well to avoid a race condition with the link
    // element not yet existing.
    if (
      conversionApi.consumable.consume(
        data.item,
        'attribute:htmlLinkAttributes:imageBlock',
      )
    ) {
      setViewAttributes(
        conversionApi.writer,
        data.item.getAttribute('htmlLinkAttributes'),
        linkElement,
      );
    }
  }

  return (dispatcher) => {
    dispatcher.on('attribute:linkHref:imageBlock', converter, {
      priority: 'high',
    });
  };
}

/**
 * CKEditor upload adapter that sends a request to Backdrop on file upload.
 *
 * Adapted from @ckeditor5/ckeditor5-upload/src/adapters/simpleuploadadapter
 *
 * @private
 * @implements module:upload/filerepository~UploadAdapter
 */
class BackdropImageUploadAdapter {
  /**
   * Creates a new adapter instance.
   *
   * @param {module:upload/filerepository~FileLoader} loader
   *   The file loader.
   * @param {module:upload/adapters/simpleuploadadapter~SimpleUploadConfig} options
   *   The upload options.
   */
  constructor(loader, options) {
    /**
     * FileLoader instance to use during the upload.
     *
     * @member {module:upload/filerepository~FileLoader} #loader
     */
    this.loader = loader;

    /**
     * The configuration of the adapter.
     *
     * @member {module:upload/adapters/simpleuploadadapter~SimpleUploadConfig} #options
     */
    this.options = options;
  }

  /**
   * Starts the upload process.
   *
   * @see module:upload/filerepository~UploadAdapter#upload
   * @return {Promise}
   *   Promise that the upload will be processed.
   */
  upload() {
    return this.loader.file.then(
      (file) =>
        new Promise((resolve, reject) => {
          this._initRequest();
          this._initListeners(resolve, reject, file);
          this._sendRequest(file);
        }),
    );
  }

  /**
   * Aborts the upload process.
   *
   * @see module:upload/filerepository~UploadAdapter#abort
   */
  abort() {
    if (this.xhr) {
      this.xhr.abort();
    }
  }

  /**
   * Initializes the `XMLHttpRequest` object using the URL specified as
   *
   * {@link module:upload/adapters/simpleuploadadapter~SimpleUploadConfig#uploadUrl `simpleUpload.uploadUrl`} in the editor's
   * configuration.
   */
  _initRequest() {
    this.xhr = new XMLHttpRequest();

    this.xhr.open('POST', this.options.uploadUrl, true);
    this.xhr.responseType = 'json';
  }

  /**
   * Initializes XMLHttpRequest listeners
   *
   * @private
   *
   * @param {Function} resolve
   *  Callback function to be called when the request is successful.
   * @param {Function} reject
   *  Callback function to be called when the request cannot be completed.
   * @param {File} file
   *  Native File object.
   */
  _initListeners(resolve, reject, file) {
    const xhr = this.xhr;
    const loader = this.loader;
    const genericErrorText = `Couldn't upload file: ${file.name}.`;

    xhr.addEventListener('error', () => reject(genericErrorText));
    xhr.addEventListener('abort', () => reject());
    xhr.addEventListener('load', () => {
      const response = xhr.response;

      if (!response || response.error) {
        return reject(
          response && response.error && response.error.message
            ? response.error.message
            : genericErrorText,
        );
      }
      // Resolve with the `urls` property and pass the response
      // to allow customizing the behavior of features relying on the upload
      // adapters.
      resolve({
        response,
        urls: { default: response.url },
      });
    });

    // Upload progress when it is supported.
    if (xhr.upload) {
      xhr.upload.addEventListener('progress', (evt) => {
        if (evt.lengthComputable) {
          loader.uploadTotal = evt.total;
          loader.uploaded = evt.loaded;
        }
      });
    }
  }

  /**
   * Prepares the data and sends the request.
   *
   * @param {File} file
   *   File instance to be uploaded.
   */
  _sendRequest(file) {
    // Set headers if specified.
    const headers = this.options.headers || {};

    // Use the withCredentials flag if specified.
    const withCredentials = this.options.withCredentials || false;

    Object.keys(headers).forEach((headerName) => {
      this.xhr.setRequestHeader(headerName, headers[headerName]);
    });

    this.xhr.withCredentials = withCredentials;

    // Prepare the form data.
    const data = new FormData();

    data.append('upload', file);

    // Send the request.
    this.xhr.send(data);
  }
}

})(CKEditor5);
