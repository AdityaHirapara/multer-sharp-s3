import { forkJoin, from, Observable } from 'rxjs'
import { map, mergeMap, toArray } from 'rxjs/operators'
import * as sharp from 'sharp'
import { ManagedUpload } from 'aws-sdk/lib/s3/managed_upload'
import { StorageEngine } from 'multer'
import getSharpOptions from './get-sharp-options'
import transformer from './transformer'
import defaultKey from "./get-filename";
import { S3StorageOptions, SharpOptions, ExtendSize } from './types'

type ExtendResult = ExtendSize & { currentSize: number, ContentType: 'string' }
type MapResult = ManagedUpload.SendData & ExtendResult
interface S3Storage {
  opts: S3StorageOptions
  sharpOpts: SharpOptions
  _getKey: (req, file, cb) => void
}
class S3Storage implements StorageEngine {
  constructor(options: S3StorageOptions) {
    options.Bucket = options.Bucket || process.env.AWS_BUCKET || null
    options.ACL = options.ACL || process.env.AWS_ACL || 'public-read'
    options.s3 = options.s3

    if (!options.Bucket) {
      throw new Error('You have to specify bucket for AWS S3 to work.')
    }

    if (!options.s3) {
      throw new Error('You have to specify bucket for AWS S3 to work.')
    }

    if (!options.Key || typeof options.Key !== 'string') {
      this._getKey = defaultKey
    }

    this.opts = options
    this.sharpOpts = getSharpOptions(options)
  }

  public _handleFile(req, file, cb) {
    const { opts, sharpOpts } = this
    const { stream } = file
    if (!opts.Key || typeof opts.Key !== 'string') {
      this._getKey(req, file, (fileErr, Key) => {
        let params = {
          Bucket: opts.Bucket,
          ACL: opts.ACL,
          CacheControl: opts.CacheControl,
          ContentType: opts.ContentType,
          Metadata: opts.Metadata,
          StorageClass: opts.StorageClass,
          ServerSideEncryption: opts.ServerSideEncryption,
          SSEKMSKeyId: opts.SSEKMSKeyId,
          Body: stream,
          Key,
        }

        this._uploadProcess(params, stream, cb)
      })
    } else {
      const params = {
        Bucket: opts.Bucket,
        ACL: opts.ACL,
        CacheControl: opts.CacheControl,
        ContentType: opts.ContentType,
        Metadata: opts.Metadata,
        StorageClass: opts.StorageClass,
        ServerSideEncryption: opts.ServerSideEncryption,
        SSEKMSKeyId: opts.SSEKMSKeyId,
        Body: stream,
        Key: opts.Key,
      }

      this._uploadProcess(params, stream, cb)
    }
  }

  public _removeFile(req, file, cb) {
    this.opts.s3.deleteObject({ Bucket: file.Bucket, Key: file.Key }, cb)
  }

  private _bindSizeToPromise(size: ExtendResult, upload: ManagedUpload) {
    return new Promise(function(resolve, reject) {
      let currentSize = { [size.suffix]: 0 }
      upload.on('httpUploadProgress', function(ev) {
        if (ev.total) {
          currentSize[size.suffix] = ev.total
        }
      })
      upload.promise().then(function(result) {
        resolve({
          ...result,
          currentSize: size.currentSize || currentSize[size.suffix],
          suffix: size.suffix,
          ContentType: size.ContentType,
        })
      }, reject)
    })
  }

  private _bindMetaToPromise(size, metadata) {
    return new Promise(function(resolve, reject) {
      metadata.then(function(result) {
        resolve({
          ...size,
          ContentType: result.format,
          currentSize: result.size,
        })
      }, reject)
    })
  }

  private _uploadProcess(params, stream, cb) {
    const { opts, sharpOpts } = this
    if (opts.multiple && Array.isArray(opts.resize) && opts.resize.length > 0) {
      const sizes = from(opts.resize)
      const resizeImage = function(size) {
        const resizerStream = transformer(sharpOpts, size)
        if (size.suffix === 'original') {
          size.Body = stream.pipe(sharp())
        } else {
          size.Body = stream.pipe(resizerStream)
        }
        return size
      }
      const getMeta = (size) => {
        const meta = { stream: size.Body }
        const getMetaFromSharp = meta.stream.metadata()
        const promise = this._bindMetaToPromise(size, getMetaFromSharp)
        return from(promise)
      }
      const eachUpload = (size) => {
        const { Body, ContentType } = size
        let currentSize = { [size.suffix]: 0 }
        let newParams = {
          ...params,
          Body,
          ContentType,
          Key: `${params.Key}-${size.suffix}`,
        }
        const upload = opts.s3.upload(newParams)
        const promise = this._bindSizeToPromise(size, upload)
        return from(promise)
      }
      const resizeWithSharp = map(resizeImage)
      const getContentType = mergeMap(getMeta)
      const uploadToAws = mergeMap(eachUpload)
      sizes
        .pipe(
          resizeWithSharp,
          getContentType,
          uploadToAws,
          toArray()
        )
        .subscribe((res) => {
          const mapArrayToObject = res.reduce((acc, curr: MapResult) => {
            acc[curr.suffix] = {}
            acc[curr.suffix].Location = curr.Location
            acc[curr.suffix].Key = curr.Key
            acc[curr.suffix].Size = curr.currentSize
            acc[curr.suffix].Bucket = curr.Bucket
            acc[curr.suffix].ACL = opts.ACL
            acc[curr.suffix].ContentType = opts.ContentType || curr.ContentType
            acc[curr.suffix].ContentDisposition = opts.ContentDisposition
            acc[curr.suffix].StorageClass = opts.StorageClass
            acc[curr.suffix].ServerSideEncryption = opts.ServerSideEncryption
            acc[curr.suffix].Metadata = opts.Metadata
            acc[curr.suffix].ETag = curr.ETag
            return acc
          }, {})

          cb(null, mapArrayToObject)
        }, cb)
    } else {
      let currentSize = 0
      const resizerStream = transformer(sharpOpts, sharpOpts.resize)
      params.Body = stream.pipe(resizerStream)
      const meta = { stream: params.Body }
      const meta$: Observable<{ format: string }> = from(meta.stream.metadata())
      meta$.subscribe((metadata) => {
        params.ContentType = opts.ContentType || metadata.format
        const upload = opts.s3.upload(params)
        upload.on('httpUploadProgress', function(ev) {
          if (ev.total) {
            currentSize = ev.total
          }
        })
        const upload$ = from(upload.promise())
        upload$.subscribe((result) => {
          cb(null, {
            Size: currentSize,
            Bucket: opts.Bucket,
            ACL: opts.ACL,
            ContentType: opts.ContentType || metadata.format,
            ContentDisposition: opts.ContentDisposition,
            StorageClass: opts.StorageClass,
            ServerSideEncryption: opts.ServerSideEncryption,
            Metadata: opts.Metadata,
            Location: result.Location,
            ETag: result.ETag,
            Key: result.Key,
          })
        }, cb)
      }, cb)
    }
  }
}

function s3Storage(options: S3StorageOptions) {
  return new S3Storage(options)
}

export default s3Storage
